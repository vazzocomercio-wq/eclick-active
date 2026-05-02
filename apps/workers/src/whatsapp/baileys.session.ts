import {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeWASocket,
  type WASocket,
  type WAMessage,
  type WAMessageContent,
  type ConnectionState,
} from '@whiskeysockets/baileys';
import pino from 'pino';
import { getSupabase } from '../supabase.js';
import { broadcastRealtime } from './internal-api-client.js';
import { loadAuthState, type BaileysAuthHandle } from './baileys-auth-state.js';

interface SessionContext {
  channelId: string;
  orgId: string;
  /** True quando a sessão NÃO tem auth state ainda (precisa pareamento via QR) */
  needsPairing: boolean;
}

/**
 * Gerencia uma sessão Baileys (= 1 socket WhatsApp Web pra um canal).
 * Encapsula:
 *   - Boot (carrega auth state, conecta)
 *   - Eventos: connection.update (QR/connected/disconnected), creds.update
 *     (auto-save), messages.upsert (persistência)
 *   - Reconnect simples (Baileys reaproveita auth state quando conexão cai)
 *   - Cleanup explícito
 */
export class BaileysSession {
  private sock: WASocket | null = null;
  private auth: BaileysAuthHandle | null = null;
  private currentQr: string | null = null;
  private connecting = false;
  private terminated = false;

  private readonly logger = pino({
    level: process.env.BAILEYS_LOG_LEVEL ?? 'warn',
    base: { sess: 'baileys' },
  });

  constructor(private readonly ctx: SessionContext) {}

  get channelId(): string {
    return this.ctx.channelId;
  }

  get orgId(): string {
    return this.ctx.orgId;
  }

  get qr(): string | null {
    return this.currentQr;
  }

  async start(): Promise<void> {
    if (this.connecting || this.terminated) return;
    this.connecting = true;

    try {
      this.auth = await loadAuthState(this.ctx.channelId);
      const { version } = await fetchLatestBaileysVersion();

      this.sock = makeWASocket({
        version,
        auth: this.auth.state,
        printQRInTerminal: false,
        browser: Browsers.appropriate('e-Click Active'),
        logger: this.logger as never,
        // Não buscamos histórico antigo — só mensagens novas a partir da conexão
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      this.sock.ev.on('creds.update', () => {
        void this.auth?.saveCreds();
      });

      this.sock.ev.on('connection.update', (update) => {
        void this.onConnectionUpdate(update).catch((err) => {
          // eslint-disable-next-line no-console
          console.error(`[baileys ${this.ctx.channelId}] connection.update erro:`, err);
        });
      });

      this.sock.ev.on('messages.upsert', (m) => {
        if (m.type !== 'notify') return;
        for (const msg of m.messages) {
          void this.persistInbound(msg).catch((err) => {
            // eslint-disable-next-line no-console
            console.error(`[baileys ${this.ctx.channelId}] persistInbound erro:`, err);
          });
        }
      });
    } finally {
      this.connecting = false;
    }
  }

  async stop(): Promise<void> {
    this.terminated = true;
    this.sock?.end(undefined);
    this.sock = null;
  }

  // ──────────────────────────────────────────────────────────
  // Event handlers
  // ──────────────────────────────────────────────────────────

  private async onConnectionUpdate(update: Partial<ConnectionState>): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      this.currentQr = qr;
      void broadcastRealtime({
        org_id: this.ctx.orgId,
        event: 'whatsapp:qr',
        payload: { channel_id: this.ctx.channelId, qr },
      });
    }

    if (connection === 'open') {
      this.currentQr = null;
      const me = this.sock?.user;
      const phone = me?.id ? extractPhoneFromJid(me.id) : null;
      const displayName = me?.name ?? me?.verifiedName ?? undefined;

      await this.markChannelActive(phone, displayName);

      void broadcastRealtime({
        org_id: this.ctx.orgId,
        event: 'whatsapp:connected',
        payload: {
          channel_id: this.ctx.channelId,
          phone_number: phone ?? '',
          ...(displayName ? { display_name: displayName } : {}),
        },
      });
    }

    if (connection === 'close') {
      // lastDisconnect.error é um Boom — extraímos output.statusCode sem
      // depender da lib (evita uma dep extra no worker).
      const errOutput = (
        lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output;
      const code = errOutput?.statusCode;
      const isLoggedOut = code === DisconnectReason.loggedOut;
      const reason = isLoggedOut
        ? 'logged_out'
        : (lastDisconnect?.error?.message ?? `code:${code ?? 'unknown'}`);

      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] disconnected (code=${code} reason=${reason})`,
      );

      if (isLoggedOut) {
        await this.auth?.clear();
        await this.markChannelDisconnected(reason);
      } else {
        // Pra outros disconnects, deixa marcado como 'error' temporário —
        // o BaileysManager vai tentar reconectar no próximo poll cycle.
        await this.markChannelError(reason);
      }

      void broadcastRealtime({
        org_id: this.ctx.orgId,
        event: 'whatsapp:disconnected',
        payload: {
          channel_id: this.ctx.channelId,
          reason,
          needs_reauth: isLoggedOut,
        },
      });

      this.sock = null;
    }
  }

  private async persistInbound(msg: WAMessage): Promise<void> {
    if (!msg.message || msg.key.fromMe) return; // ignora outbound (eco) e tombstones

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us')) return; // ignora grupos no MVP

    const phone = extractPhoneFromJid(remoteJid);
    if (!phone) return;

    const senderName = msg.pushName ?? undefined;
    const messageId = msg.key.id ?? `${Date.now()}-${Math.random()}`;

    const parsed = extractContent(msg.message);
    if (!parsed) return; // tipo não suportado no MVP

    const supabase = getSupabase();

    // 1) findOrCreate contact (por org_id + phone)
    const contactId = await this.findOrCreateContact(phone, senderName);
    if (!contactId) return;

    // 2) findOrCreate conversation
    const conversationId = await this.findOrCreateConversation(contactId);
    if (!conversationId) return;

    // 3) Persiste mensagem (idempotente: índice único em
    //    (channel_id, channel_message_id) bate dedup)
    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        org_id: this.ctx.orgId,
        conversation_id: conversationId,
        direction: 'inbound',
        sender_type: 'contact',
        sender_id: null,
        content_type: parsed.kind,
        content: parsed,
        plain_text: parsed.kind === 'text' ? parsed.body : null,
        channel_message_id: messageId,
        status: 'delivered',
        is_internal_note: false,
        metadata: {},
      })
      .select('*')
      .single();

    if (error) {
      // 23505 = duplicata; ignora
      if ((error as { code?: string }).code === '23505') return;
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] insert message falhou: ${error.message}`,
      );
      return;
    }

    // 4) Emite message:new pro frontend (re-fetch da row inserida)
    void broadcastRealtime({
      org_id: this.ctx.orgId,
      event: 'message:new',
      payload: { conversation_id: conversationId, message: inserted },
    });
  }

  // ──────────────────────────────────────────────────────────
  // DB helpers
  // ──────────────────────────────────────────────────────────

  private async findOrCreateContact(
    phone: string,
    senderName: string | undefined,
  ): Promise<string | null> {
    const supabase = getSupabase();

    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', this.ctx.orgId)
      .eq('phone', phone)
      .maybeSingle();

    if (existing?.id) return existing.id as string;

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        org_id: this.ctx.orgId,
        phone,
        name: senderName ?? null,
        source: 'whatsapp',
      })
      .select('id')
      .single();

    if (error || !created) {
      // eslint-disable-next-line no-console
      console.warn(`[baileys ${this.ctx.channelId}] createContact falhou:`, error);
      return null;
    }
    return created.id as string;
  }

  private async findOrCreateConversation(contactId: string): Promise<string | null> {
    const supabase = getSupabase();

    const { data: existing } = await supabase
      .from('conversations')
      .select('id')
      .eq('org_id', this.ctx.orgId)
      .eq('contact_id', contactId)
      .eq('channel_id', this.ctx.channelId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) return existing.id as string;

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        org_id: this.ctx.orgId,
        contact_id: contactId,
        channel_id: this.ctx.channelId,
        channel_type: 'whatsapp_free',
        status: 'open',
      })
      .select('id')
      .single();

    if (error || !created) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] createConversation falhou:`,
        error,
      );
      return null;
    }
    return created.id as string;
  }

  private async markChannelActive(
    phone: string | null,
    displayName: string | undefined,
  ): Promise<void> {
    const supabase = getSupabase();
    const patch: Record<string, unknown> = {
      status: 'active',
      error_message: null,
      last_webhook_at: new Date().toISOString(),
    };
    if (phone) patch.phone_number = phone;
    if (displayName) patch.external_id = displayName;
    await supabase.from('channels').update(patch).eq('id', this.ctx.channelId);
  }

  private async markChannelDisconnected(reason: string): Promise<void> {
    const supabase = getSupabase();
    await supabase
      .from('channels')
      .update({ status: 'disconnected', error_message: reason })
      .eq('id', this.ctx.channelId);
  }

  private async markChannelError(reason: string): Promise<void> {
    const supabase = getSupabase();
    await supabase
      .from('channels')
      .update({ status: 'error', error_message: reason })
      .eq('id', this.ctx.channelId);
  }
}

// ──────────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────────

function extractPhoneFromJid(jid: string): string | null {
  // JID format: '5571999999999@s.whatsapp.net' ou '5571999999999:21@s.whatsapp.net'
  const m = /^(\d+)/.exec(jid);
  return m?.[1] ?? null;
}

interface TextContent {
  kind: 'text';
  body: string;
}
interface ImageContent {
  kind: 'image';
  caption?: string;
  mime_type?: string;
}
interface AudioContent {
  kind: 'audio';
  mime_type?: string;
  duration_seconds?: number;
}
interface VideoContent {
  kind: 'video';
  caption?: string;
  mime_type?: string;
}
interface DocumentContent {
  kind: 'document';
  filename?: string;
  mime_type?: string;
}

type ParsedContent =
  | TextContent
  | ImageContent
  | AudioContent
  | VideoContent
  | DocumentContent;

function extractContent(m: WAMessageContent): ParsedContent | null {
  // Texto direto
  if (m.conversation) return { kind: 'text', body: m.conversation };
  if (m.extendedTextMessage?.text) {
    return { kind: 'text', body: m.extendedTextMessage.text };
  }
  // Mídia — no MVP só registramos kind/mime/caption. Download fica como TODO.
  if (m.imageMessage) {
    return {
      kind: 'image',
      ...(m.imageMessage.caption ? { caption: m.imageMessage.caption } : {}),
      ...(m.imageMessage.mimetype ? { mime_type: m.imageMessage.mimetype } : {}),
    };
  }
  if (m.audioMessage) {
    return {
      kind: 'audio',
      ...(m.audioMessage.mimetype ? { mime_type: m.audioMessage.mimetype } : {}),
      ...(typeof m.audioMessage.seconds === 'number'
        ? { duration_seconds: m.audioMessage.seconds }
        : {}),
    };
  }
  if (m.videoMessage) {
    return {
      kind: 'video',
      ...(m.videoMessage.caption ? { caption: m.videoMessage.caption } : {}),
      ...(m.videoMessage.mimetype ? { mime_type: m.videoMessage.mimetype } : {}),
    };
  }
  if (m.documentMessage) {
    return {
      kind: 'document',
      ...(m.documentMessage.fileName ? { filename: m.documentMessage.fileName } : {}),
      ...(m.documentMessage.mimetype ? { mime_type: m.documentMessage.mimetype } : {}),
    };
  }
  return null;
}
