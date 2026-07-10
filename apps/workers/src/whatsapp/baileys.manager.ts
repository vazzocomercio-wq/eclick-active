import { hostname } from 'node:os';
import { randomBytes } from 'node:crypto';
import { getSupabase } from '../supabase.js';
import { BaileysSession, type OutboundContent } from './baileys.session.js';

/**
 * TTL da lease distribuída por canal (CRÍTICO — anti split-brain). Com 2+
 * réplicas do worker, cada uma abriria socket pro mesmo canal → WhatsApp
 * derruba com stream conflict (440) e as duas corrompem o auth. A lease
 * garante que só UMA réplica mantém o socket de cada canal.
 *
 * TTL 90s, renovado a cada 45s (metade). Se a réplica dona morrer, a lease
 * expira em ≤90s e outra assume.
 */
const LEASE_TTL_SEC = Number(process.env.BAILEYS_LEASE_TTL_SEC ?? 90);
const LEASE_RENEW_MS = Math.max(5000, (LEASE_TTL_SEC / 2) * 1000);

/** Backoff máximo quando o DB está fora (evita marteladas a cada 3s). */
const DB_BACKOFF_MAX_MS = 60_000;

/** Cliente minimal só pros RPCs de lock (evita fricção de tipos do rpc). */
interface LockRpcClient {
  rpc: (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>;
}

interface ChannelRow {
  id: string;
  org_id: string;
  status: 'active' | 'paused' | 'error' | 'pending' | 'disconnected';
  credentials: { baileys_auth?: unknown } | null;
  created_at: string;
  updated_at: string;
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
  private renewTimer: NodeJS.Timeout | null = null;
  private syncing = false;
  private stopped = false;
  /** Última assinatura do estado dos canais — usada pra evitar log repetido a cada 3s */
  private lastStateSig = '__init__';

  /**
   * Identidade única deste processo/réplica pra segurar as leases. Se 2
   * réplicas rodam, cada uma tem um holderId distinto e disputam o lock.
   */
  private readonly holderId = `${hostname()}-${process.pid}-${randomBytes(3).toString('hex')}`;

  /** Canais cuja lease este processo detém no momento. */
  private readonly leasedChannels = new Set<string>();

  /** Instante (epoch ms) até quando pular sync por backoff de falha de DB. */
  private dbBackoffUntil = 0;
  /** Falhas consecutivas de DB — controla o crescimento do backoff. */
  private dbFailures = 0;

  async start(): Promise<void> {
    const intervalSec = Number(process.env.BAILEYS_POLL_INTERVAL_SEC ?? 3);
    // eslint-disable-next-line no-console
    console.log(
      `[baileys-manager] iniciando polling a cada ${intervalSec}s (holder=${this.holderId})`,
    );

    // Sync inicial síncrono (aguarda restore das sessões existentes)
    await this.syncOnce();

    this.timer = setInterval(() => {
      void this.syncOnce();
    }, intervalSec * 1000);

    // Renovação periódica das leases enquanto as sessões vivem.
    this.renewTimer = setInterval(() => {
      void this.renewLeases();
    }, LEASE_RENEW_MS);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.renewTimer = null;
    await Promise.allSettled(
      Array.from(this.sessions.values()).map((s) => s.stop()),
    );
    // Libera todas as leases pra outra réplica assumir imediatamente (sem
    // esperar o TTL expirar).
    await Promise.allSettled(
      Array.from(this.leasedChannels).map((id) => this.releaseLease(id)),
    );
    this.sessions.clear();
  }

  // ──────────────────────────────────────────────────────────
  // Lease distribuída (CRÍTICO)
  // ──────────────────────────────────────────────────────────

  /**
   * Adquire OU renova a lease do canal via RPC try_acquire_lock.
   *   - retorna true  → temos a lease (livre, expirada, ou já era nossa).
   *   - retorna false → outra réplica detém (não devemos abrir socket).
   * Fail-open: se o RPC falhar por erro de INFRA (não "lock ocupado"),
   * assume true — melhor manter o WhatsApp no ar do que travar por causa
   * de um hiccup no banco. Sempre loga.
   */
  private async tryAcquireLease(channelId: string): Promise<boolean> {
    const client = getSupabase() as unknown as LockRpcClient;
    try {
      const { data, error } = await client.rpc('try_acquire_lock', {
        p_name: `baileys:channel:${channelId}`,
        p_holder: this.holderId,
        p_ttl_seconds: LEASE_TTL_SEC,
      });
      if (error) {
        // eslint-disable-next-line no-console
        console.warn(
          `[baileys-manager] lease RPC erro (fail-open) ${channelId}: ${error.message ?? 'unknown'}`,
        );
        return true; // fail-open
      }
      return data === true;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys-manager] lease exceção (fail-open) ${channelId}:`,
        err instanceof Error ? err.message : err,
      );
      return true; // fail-open
    }
  }

  private async releaseLease(channelId: string): Promise<void> {
    this.leasedChannels.delete(channelId);
    const client = getSupabase() as unknown as LockRpcClient;
    try {
      await client.rpc('release_lock', {
        p_name: `baileys:channel:${channelId}`,
        p_holder: this.holderId,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys-manager] release lease ${channelId} falhou:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  /**
   * Renova as leases de todos os canais que seguramos. Se a renovação falhar
   * (retornou false = outra réplica assumiu), paramos a sessão graciosamente
   * pra não brigar pelo socket.
   */
  private async renewLeases(): Promise<void> {
    if (this.stopped) return;
    for (const channelId of Array.from(this.leasedChannels)) {
      if (!this.sessions.has(channelId)) {
        this.leasedChannels.delete(channelId);
        continue;
      }
      const ok = await this.tryAcquireLease(channelId);
      if (!ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[baileys-manager] lease de ${channelId} perdida (outra réplica assumiu) — parando sessão`,
        );
        const sess = this.sessions.get(channelId);
        if (sess) {
          await sess.stop().catch(() => {});
          this.sessions.delete(channelId);
        }
        this.leasedChannels.delete(channelId);
      }
    }
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

  /**
   * Pergunta ao Baileys se um telefone tem WhatsApp ativo. Retorna o JID
   * canônico, foto de perfil e nome (quando disponíveis).
   *
   * Usa a primeira sessão ativa da org pra fazer a verificação. Se não tem
   * sessão ativa pra essa org, lança `no_active_session`.
   *
   * Lança erros tipados (similar a sendMessage) pra que o HTTP handler
   * possa traduzir em status code:
   *   - `no_active_session`: 503 (worker não tem nenhuma sessão pareada)
   */
  async checkNumber(
    orgId: string,
    phone: string,
  ): Promise<{
    exists: boolean;
    jid?: string;
    profile_name?: string;
    profile_pic_url?: string;
  }> {
    // Pega qualquer sessão pareada da org pra fazer a checagem
    const session = Array.from(this.sessions.values()).find(
      (s) => s.orgId === orgId && s.isReady(),
    );
    if (!session) {
      throw new Error(`no_active_session: org=${orgId}`);
    }
    return session.checkNumber(phone);
  }

  /**
   * QR atual de um canal em pareamento (null se não houver sessão/QR).
   * Usado pelo endpoint interno de diagnóstico de reconexão.
   */
  getQr(channelId: string): string | null {
    return this.sessions.get(channelId)?.qr ?? null;
  }

  // ──────────────────────────────────────────────────────────

  private async syncOnce(): Promise<void> {
    if (this.syncing || this.stopped) return;
    // Backoff quando o DB está fora: em vez de martelar a cada 3s, espera
    // um intervalo crescente (HIGH).
    if (Date.now() < this.dbBackoffUntil) return;
    this.syncing = true;
    try {
      const supabase = getSupabase();
      const { data, error } = await supabase
        .from('channels')
        .select('id, org_id, status, credentials, created_at, updated_at')
        .eq('channel_type', 'whatsapp_free')
        .in('status', ['active', 'pending', 'error']);

      if (error) {
        this.dbFailures += 1;
        const backoff = Math.min(2000 * 2 ** (this.dbFailures - 1), DB_BACKOFF_MAX_MS);
        this.dbBackoffUntil = Date.now() + backoff;
        // eslint-disable-next-line no-console
        console.warn(
          `[baileys-manager] sync falhou (${this.dbFailures}x): ${error.message} — backoff ${Math.round(backoff / 1000)}s`,
        );
        return;
      }
      // Sucesso — zera o backoff.
      this.dbFailures = 0;
      this.dbBackoffUntil = 0;

      const allRows = (data ?? []) as ChannelRow[];

      // Log de diagnóstico — só quando o estado muda pra não poluir
      const stateSig = allRows
        .map((r) => `${r.id.slice(0, 8)}:${r.status}`)
        .sort()
        .join(',');
      if (stateSig !== this.lastStateSig) {
        // eslint-disable-next-line no-console
        console.log(
          `[baileys-manager] poll: ${allRows.length} canais [${stateSig || 'nenhum'}]`,
        );
        this.lastStateSig = stateSig;
      }

      // Limpeza: apaga canais pending sem auth_state que estouraram TTL.
      // São tentativas de pareamento abandonadas (user fechou dialog,
      // sessão expirou, etc).
      const now = Date.now();
      const orphanIds = new Set<string>();
      for (const row of allRows) {
        if (row.status !== 'pending') continue;
        if (row.credentials?.baileys_auth) continue;
        // BUGFIX: mede a idade desde a ENTRADA em pending (updated_at), não
        // desde a criação do canal (created_at). Antes, reconectar um canal
        // antigo (setar status=pending) fazia o cleanup deletá-lo na hora,
        // porque created_at tinha dias/semanas. Fallback pra created_at se
        // updated_at faltar.
        const pendingSince = new Date(row.updated_at ?? row.created_at).getTime();
        const ageSec = (now - pendingSince) / 1000;
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
          if (this.leasedChannels.has(row.id)) await this.releaseLease(row.id);
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
          if (this.leasedChannels.has(id)) await this.releaseLease(id);
        }
      }

      // Inicia sessões novas
      for (const row of rows) {
        if (this.sessions.has(row.id)) continue;

        // CRÍTICO: adquire a lease ANTES de abrir o socket. Se outra réplica
        // já detém, pula este canal (não abre socket → sem stream conflict).
        // Com 1 réplica (realidade atual) a lease está sempre livre → sempre
        // adquirida → comportamento idêntico ao de antes.
        const gotLease = await this.tryAcquireLease(row.id);
        if (!gotLease) {
          // eslint-disable-next-line no-console
          console.log(
            `[baileys-manager] canal ${row.id} detido por outra réplica — pulando`,
          );
          continue;
        }
        this.leasedChannels.add(row.id);

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
          // Libera a lease pra que outra réplica (ou a próxima iteração)
          // possa tentar assumir o canal.
          await this.releaseLease(row.id);
        }
      }
    } finally {
      this.syncing = false;
    }
  }
}
