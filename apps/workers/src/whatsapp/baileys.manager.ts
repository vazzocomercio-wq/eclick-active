import { getSupabase } from '../supabase.js';
import { BaileysSession, type OutboundContent } from './baileys.session.js';

interface ChannelRow {
  id: string;
  org_id: string;
  status: 'active' | 'paused' | 'error' | 'pending' | 'disconnected';
  credentials: { baileys_auth?: unknown } | null;
  created_at: string;
}

/**
 * Idade máxima de um canal pending sem auth antes de ser considerado
 * órfão e apagado pelo cleanup. 10 minutos é suficiente — o pareamento
 * normal leva ~30s. Canais que ficam pending > 10min foram abandonados
 * (user fechou aba, perdeu conexão, etc).
 */
const PENDING_TTL_SECONDS = 10 * 60;

/**
 * Orquestra todas as sessões Baileys do worker. Faz polling em
 * `active.channels` filtrando `channel_type='whatsapp_free'` e mantém:
 *   - Pra cada channel `pending` SEM auth_state → cria sessão (gera QR)
 *   - Pra cada channel `active` com auth_state → restaura sessão (sem QR)
 *   - Pra cada channel removido / `disconnected`/`paused` → encerra sessão
 *   - Pra cada channel `error` (queda transitória) → tenta reconectar
 *
 * Polling é simples (3s) — ESM/Realtime no schema custom adiciona
 * complexidade de publication que não vale pra MVP.
 */
export class BaileysManager {
  private readonly sessions = new Map<string, BaileysSession>();
  private timer: NodeJS.Timeout | null = null;
  private syncing = false;
  private stopped = false;

  async start(): Promise<void> {
    const intervalSec = Number(process.env.BAILEYS_POLL_INTERVAL_SEC ?? 3);
    // eslint-disable-next-line no-console
    console.log(`[baileys-manager] iniciando polling a cada ${intervalSec}s`);

    // Sync inicial síncrono (aguarda restore das sessões existentes)
    await this.syncOnce();

    this.timer = setInterval(() => {
      void this.syncOnce();
    }, intervalSec * 1000);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await Promise.allSettled(
      Array.from(this.sessions.values()).map((s) => s.stop()),
    );
    this.sessions.clear();
  }

  // ──────────────────────────────────────────────────────────
  // Outbound — chamado pelo HTTP server interno quando API recebe um
  // POST /conversations/:id/messages e o canal é whatsapp_free.
  // ──────────────────────────────────────────────────────────

  /**
   * Envia uma mensagem pelo canal indicado. Lança erros tipados pra que o
   * HTTP server possa traduzir em status code apropriado:
   *   - `channel_not_found`: 404
   *   - `session_not_ready`: 503 (canal existe mas socket ainda não abriu)
   *   - outros: 500
   */
  async sendMessage(
    channelId: string,
    phone: string,
    content: OutboundContent,
  ): Promise<{ message_id: string }> {
    const session = this.sessions.get(channelId);
    if (!session) {
      throw new Error(`channel_not_found: ${channelId}`);
    }
    if (!session.isReady()) {
      throw new Error(`session_not_ready: ${channelId}`);
    }
    const messageId = await session.sendMessage(phone, content);
    return { message_id: messageId };
  }

  // ──────────────────────────────────────────────────────────

  private async syncOnce(): Promise<void> {
    if (this.syncing || this.stopped) return;
    this.syncing = true;
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('channels')
        .select('id, org_id, status, credentials, created_at')
        .eq('channel_type', 'whatsapp_free')
        .in('status', ['active', 'pending', 'error']);

      if (error) {
        // eslint-disable-next-line no-console
        console.warn(`[baileys-manager] sync falhou: ${error.message}`);
        return;
      }

      const allRows = (data ?? []) as ChannelRow[];

      // Limpeza: apaga canais pending sem auth_state que estouraram TTL.
      // São tentativas de pareamento abandonadas (user fechou dialog,
      // sessão expirou, etc).
      const now = Date.now();
      const orphanIds = new Set<string>();
      for (const row of allRows) {
        if (row.status !== 'pending') continue;
        if (row.credentials?.baileys_auth) continue;
        const ageSec = (now - new Date(row.created_at).getTime()) / 1000;
        if (ageSec > PENDING_TTL_SECONDS) {
          // eslint-disable-next-line no-console
          console.log(
            `[baileys-manager] cleanup: deletando canal pending órfão ${row.id} (idade=${Math.round(ageSec)}s)`,
          );
          // Encerra sessão local antes de deletar do banco
          const sess = this.sessions.get(row.id);
          if (sess) {
            await sess.stop().catch(() => {});
            this.sessions.delete(row.id);
          }
          await supabase.from('channels').delete().eq('id', row.id);
          orphanIds.add(row.id);
        }
      }

      // Filtra os já-deletados pra não recriar sessão pra eles na sequência
      const rows = allRows.filter((r) => !orphanIds.has(r.id));
      const wantedIds = new Set(rows.map((r) => r.id));

      // Encerra sessões que sumiram do conjunto desejado
      for (const [id, sess] of this.sessions) {
        if (!wantedIds.has(id)) {
          // eslint-disable-next-line no-console
          console.log(`[baileys-manager] encerrando sessão ${id} (removed/disconnected)`);
          await sess.stop();
          this.sessions.delete(id);
        }
      }

      // Inicia sessões novas
      for (const row of rows) {
        if (this.sessions.has(row.id)) continue;
        // eslint-disable-next-line no-console
        console.log(
          `[baileys-manager] iniciando sessão ${row.id} (status=${row.status})`,
        );
        const sess = new BaileysSession({
          channelId: row.id,
          orgId: row.org_id,
          needsPairing: !row.credentials?.baileys_auth,
        });
        this.sessions.set(row.id, sess);
        try {
          await sess.start();
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error(
            `[baileys-manager] start ${row.id} falhou:`,
            err instanceof Error ? err.message : err,
          );
          this.sessions.delete(row.id);
        }
      }
    } finally {
      this.syncing = false;
    }
  }
}
