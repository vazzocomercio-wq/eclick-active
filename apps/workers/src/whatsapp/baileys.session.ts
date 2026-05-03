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
import {
  broadcastRealtime,
  notifyInboundProcessed,
} from './internal-api-client.js';
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
  // OUTBOUND — chamado pelo internal HTTP server quando a API
  // recebe POST /conversations/:id/messages e o canal é whatsapp_free.
  // ──────────────────────────────────────────────────────────

  /**
   * Envia mensagem via Baileys WebSocket. Requer sessão `connection === 'open'`.
   *
   * @param phone Número internacional sem `+` ou JID completo (ex: `5571999999999`
   *   ou `5571999999999@s.whatsapp.net`).
   * @param content Conteúdo a enviar — text/image/audio/video/document.
   * @returns ID da mensagem no protocolo Baileys (ex: `3EB0...`).
   */
  async sendMessage(phone: string, content: OutboundContent): Promise<string> {
    if (!this.sock) {
      throw new Error('session_not_ready: socket Baileys ainda não conectado');
    }
    if (this.terminated) {
      throw new Error('session_terminated: sessão encerrada');
    }

    // Pra BR: normaliza o telefone antes de virar JID (adiciona DDI 55
    // se não tiver, garante o 9 inicial em DDD móvel). Sem isso, números
    // como "71994095636" ficavam ambíguos e o WhatsApp roteava pro JID
    // legacy de 8 dígitos (conta de outra pessoa com número antigo).
    const normalized = phone.includes('@')
      ? phone
      : (brPhoneCandidates(phone.replace(/\D/g, ''))[0] ?? phone.replace(/\D/g, ''));
    const jid = normalized.includes('@') ? normalized : `${normalized}@s.whatsapp.net`;
    // eslint-disable-next-line no-console
    console.log(
      `[baileys ${this.ctx.channelId}] sendMessage → input="${phone}" normalized="${normalized}" jid="${jid}" kind=${content.kind}`,
    );

    let payload: Parameters<WASocket['sendMessage']>[1];
    switch (content.kind) {
      case 'text':
        payload = { text: content.body };
        break;
      case 'image':
        payload = {
          image: { url: content.url },
          ...(content.caption ? { caption: content.caption } : {}),
        };
        break;
      case 'audio':
        payload = {
          audio: { url: content.url },
          mimetype: content.mime_type ?? 'audio/ogg; codecs=opus',
          ptt: content.ptt ?? true,
        };
        break;
      case 'video':
        payload = {
          video: { url: content.url },
          ...(content.caption ? { caption: content.caption } : {}),
        };
        break;
      case 'document':
        payload = {
          document: { url: content.url },
          // Baileys exige mimetype não-opcional pra documentos. Fallback
          // genérico permite enviar arquivos com tipo desconhecido.
          mimetype: content.mime_type ?? 'application/octet-stream',
          ...(content.filename ? { fileName: content.filename } : {}),
        };
        break;
      default: {
        const _exhaustive: never = content;
        throw new Error(
          `unsupported_content: ${(_exhaustive as { kind: string }).kind}`,
        );
      }
    }

    const result = await this.sock.sendMessage(jid, payload);
    if (!result?.key?.id) {
      throw new Error('send_failed: Baileys não retornou messageId');
    }
    return result.key.id;
  }

  /** True se a sessão está pronta pra enviar mensagens. */
  isReady(): boolean {
    return !!this.sock && !this.terminated;
  }

  /**
   * Pergunta ao Baileys se um número tem WhatsApp ativo. Aceita telefone
   * em formato internacional (ex: 5571999999999) ou já um JID. Retorna
   * o JID canônico (`...@s.whatsapp.net` ou `...@lid`) quando existe, e
   * tenta buscar foto de perfil e profile name (best-effort).
   *
   * Pra brasileiros, prefere o JID com o 9 inicial (formato moderno).
   * sock.onWhatsApp pode retornar JID sem 9 (formato pré-2012) mesmo
   * quando o número moderno também existe — daí mandaríamos pra outra
   * pessoa. Tenta na ordem: com 9 → sem 9 (fallback pra contas legacy).
   */
  async checkNumber(phoneOrJid: string): Promise<{
    exists: boolean;
    jid?: string;
    profile_name?: string;
    profile_pic_url?: string;
  }> {
    if (!this.sock || this.terminated) {
      throw new Error('session_not_ready');
    }

    if (phoneOrJid.includes('@')) {
      // JID direto — só consulta
      return this.checkSingle(phoneOrJid);
    }

    const digits = phoneOrJid.replace(/\D/g, '');
    if (!digits) return { exists: false };

    // Pra BR: tenta candidates em ordem (preferindo formato moderno c/ 9).
    // Pra outros países: usa o input direto sem chutar.
    const candidates = brPhoneCandidates(digits);
    for (const candidate of candidates) {
      const r = await this.checkSingle(candidate);
      if (r.exists) {
        // Workaround pra "shadow accounts" BR: quando o input é formato
        // moderno (13 dig com 9), forçar o JID construído com o 9 mesmo
        // que onWhatsApp tenha retornado JID legacy (12 dig sem 9). Em
        // alguns casos a conta legacy existe no servidor do WhatsApp com
        // foto/dados antigos preservados, mas o usuário ATIVO está só no
        // JID moderno — mensagens pro legacy "vão" mas não entregam.
        //
        // Critério: candidate tem 13 dig começando com 55 e 9 após DDD.
        if (
          candidate.length === 13 &&
          candidate.startsWith('55') &&
          candidate[4] === '9'
        ) {
          return { ...r, jid: `${candidate}@s.whatsapp.net` };
        }
        return r;
      }
    }
    return { exists: false };
  }

  /**
   * Faz UMA consulta no onWhatsApp + busca foto/nome. Helper interno.
   */
  private async checkSingle(input: string): Promise<{
    exists: boolean;
    jid?: string;
    profile_name?: string;
    profile_pic_url?: string;
  }> {
    if (!this.sock) return { exists: false };

    const results = await this.sock.onWhatsApp(input).catch(() => []);
    const first = results?.[0];
    if (!first?.exists || !first.jid) {
      return { exists: false };
    }

    const profilePicUrl = await this.sock
      .profilePictureUrl(first.jid, 'image')
      .catch(() => undefined);

    let profileName: string | undefined;
    try {
      const stored = (
        this.sock as unknown as {
          store?: { contacts?: Record<string, { name?: string; notify?: string }> };
        }
      ).store?.contacts?.[first.jid];
      if (stored?.name) profileName = stored.name;
      else if (stored?.notify) profileName = stored.notify;
    } catch {
      /* sem store, sem nome */
    }

    return {
      exists: true,
      jid: first.jid,
      ...(profileName ? { profile_name: profileName } : {}),
      ...(profilePicUrl ? { profile_pic_url: profilePicUrl } : {}),
    };
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

      this.sock = null;

      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] disconnected (code=${code} reason=${reason})`,
      );

      if (isLoggedOut) {
        // Terminal: usuário deslogou no celular ou WA invalidou a sessão.
        // Limpa auth + marca canal disconnected + avisa frontend pra
        // reescanear o QR.
        await this.auth?.clear();
        await this.markChannelDisconnected(reason);
        void broadcastRealtime({
          org_id: this.ctx.orgId,
          event: 'whatsapp:disconnected',
          payload: {
            channel_id: this.ctx.channelId,
            reason,
            needs_reauth: true,
          },
        });
        return;
      }

      // Transient (restartRequired=515 é o caso mais comum no primeiro
      // pareamento; também: connectionLost, connectionClosed, timedOut).
      // Baileys orienta a simplesmente reabrir o socket com o mesmo auth
      // state. Não marcamos erro no DB nem notificamos frontend — pro
      // usuário é reconexão silenciosa, o QR continua válido e/ou avança
      // pra "open" na sequência.
      if (this.terminated) return;
      // eslint-disable-next-line no-console
      console.log(
        `[baileys ${this.ctx.channelId}] auto-restart em 1s (transient disconnect)`,
      );
      setTimeout(() => {
        if (this.terminated) return;
        void this.start().catch((err) => {
          // eslint-disable-next-line no-console
          console.error(
            `[baileys ${this.ctx.channelId}] auto-restart falhou:`,
            err instanceof Error ? err.message : err,
          );
        });
      }, 1000);
    }
  }

  private async persistInbound(msg: WAMessage): Promise<void> {
    if (!msg.message || msg.key.fromMe) return; // ignora outbound (eco) e tombstones

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || remoteJid.endsWith('@g.us')) return; // ignora grupos no MVP

    // JID pode ser `@s.whatsapp.net` (digits = telefone real) OU `@lid`
    // (digits = pseudo-ID anônimo, NÃO é telefone). O JID completo é a
    // identidade canônica — é o que o WhatsApp usa pra rotear de volta.
    const isPhoneJid = remoteJid.endsWith('@s.whatsapp.net');
    const phone = isPhoneJid ? extractPhoneFromJid(remoteJid) : null;

    const senderName = msg.pushName ?? undefined;
    const messageId = msg.key.id ?? `${Date.now()}-${Math.random()}`;

    const parsed = extractContent(msg.message);
    if (!parsed) return; // tipo não suportado no MVP

    const supabase = getSupabase();

    // 1) findOrCreate contact (por org_id + wa_jid; fallback phone p/ legacy)
    const contactId = await this.findOrCreateContact(remoteJid, phone, senderName);
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

    // 5) Avisa a api pra rodar o pipeline de IA (classify + concierge) e
    //    automations (trigger=message_received). Sem isso, mensagens
    //    do WhatsApp Gratuito não disparam nada do lado da api.
    const insertedMessageId = (inserted as { id?: string } | null)?.id;
    if (insertedMessageId) {
      void notifyInboundProcessed({
        org_id: this.ctx.orgId,
        conversation_id: conversationId,
        contact_id: contactId,
        message_id: insertedMessageId,
        channel_id: this.ctx.channelId,
        channel_type: 'whatsapp_free',
        message_text: parsed.kind === 'text' ? parsed.body : '',
      });
    }
  }

  // ──────────────────────────────────────────────────────────
  // DB helpers
  // ──────────────────────────────────────────────────────────

  private async findOrCreateContact(
    waJid: string,
    phone: string | null,
    senderName: string | undefined,
  ): Promise<string | null> {
    const supabase = getSupabase();

    // 1) Match canônico: channel_profiles.whatsapp.wa_jid (JID completo).
    // PostgREST jsonb path: `channel_profiles->whatsapp->>wa_jid`
    const { data: byJid } = await supabase
      .from('contacts')
      .select('id, channel_profiles')
      .eq('org_id', this.ctx.orgId)
      .eq('channel_profiles->whatsapp->>wa_jid', waJid)
      .maybeSingle();

    if (byJid?.id) {
      await this.ensureWhatsappProfile(byJid.id as string, byJid.channel_profiles, waJid, senderName);
      return byJid.id as string;
    }

    // 2) Fallback legacy: contatos antigos só têm `phone` (sem wa_jid).
    // Só faz sentido se o JID for `@s.whatsapp.net` (digits = telefone real).
    if (phone) {
      const { data: byPhone } = await supabase
        .from('contacts')
        .select('id, channel_profiles')
        .eq('org_id', this.ctx.orgId)
        .eq('phone', phone)
        .maybeSingle();

      if (byPhone?.id) {
        // Backfill wa_jid no contato legacy pra próximas idas-e-vindas
        await this.ensureWhatsappProfile(byPhone.id as string, byPhone.channel_profiles, waJid, senderName);
        return byPhone.id as string;
      }
    }

    // 3) Cria novo contato com wa_jid populado
    const channelProfiles: Record<string, Record<string, string>> = {
      whatsapp: {
        wa_jid: waJid,
        ...(senderName ? { profile_name: senderName } : {}),
      },
    };

    const { data: created, error } = await supabase
      .from('contacts')
      .insert({
        org_id: this.ctx.orgId,
        phone, // null pra @lid (não é telefone real); digits pra @s.whatsapp.net
        name: senderName ?? null,
        source: 'whatsapp',
        channel_profiles: channelProfiles,
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

  /**
   * Garante que `channel_profiles.whatsapp.wa_jid` existe pro contato.
   * Usado em (a) match por JID que chegou sem profile_name salvo, e
   * (b) backfill de contatos legacy que casaram só por `phone`.
   */
  private async ensureWhatsappProfile(
    contactId: string,
    currentProfiles: unknown,
    waJid: string,
    senderName: string | undefined,
  ): Promise<void> {
    const profiles =
      (currentProfiles as Record<string, Record<string, unknown>> | null) ?? {};
    const wa = (profiles.whatsapp as Record<string, unknown> | undefined) ?? {};

    const needsJid = wa.wa_jid !== waJid;
    const needsName = senderName && !wa.profile_name;
    if (!needsJid && !needsName) return;

    const merged = {
      ...profiles,
      whatsapp: {
        ...wa,
        wa_jid: waJid,
        ...(senderName ? { profile_name: senderName } : {}),
      },
    };

    const { error } = await getSupabase()
      .from('contacts')
      .update({ channel_profiles: merged })
      .eq('id', contactId);

    if (error) {
      // eslint-disable-next-line no-console
      console.warn(
        `[baileys ${this.ctx.channelId}] ensureWhatsappProfile falhou:`,
        error.message,
      );
    }
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

// ──────────────────────────────────────────────────────────
// OUTBOUND content shapes — usadas pelo internal-server quando a API
// proxia o pedido de envio (text/image/audio/video/document).
// ──────────────────────────────────────────────────────────

export type OutboundContent =
  | { kind: 'text'; body: string }
  | { kind: 'image'; url: string; caption?: string }
  | { kind: 'audio'; url: string; mime_type?: string; ptt?: boolean }
  | { kind: 'video'; url: string; caption?: string }
  | { kind: 'document'; url: string; filename?: string; mime_type?: string };

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

// ──────────────────────────────────────────────────────────
// Normalização de telefone BR
// ──────────────────────────────────────────────────────────

/**
 * Gera candidates de telefone BR pra consulta no onWhatsApp/sendMessage.
 *
 * Brasil tem dois formatos de celular válidos:
 *   - Moderno (pós-2012): 55 + DDD + 9 + 8 dígitos = 13 dígitos
 *   - Legacy (pré-2012, ainda existe): 55 + DDD + 8 dígitos = 12 dígitos
 *
 * O sock.onWhatsApp pode retornar JID em QUALQUER um dos dois formatos
 * mesmo quando ambas as contas existem — daí "5571994095636" pode
 * resolver pra "557194095636@s.whatsapp.net" (legacy de outra pessoa).
 *
 * Estratégia: tentar PRIMEIRO o formato moderno (com 9), DEPOIS o legacy
 * como fallback. Aplicado em checkNumber e em sendMessage.
 *
 * Aceita inputs:
 *   - 11 dígitos (DDD + 9 + 8)        → adiciona 55, mantém com 9
 *   - 10 dígitos (DDD + 8 sem 9)      → adiciona 55, gera versão com 9
 *   - 12 dígitos (55 + DDD + 8 sem 9) → mantém + gera versão com 9
 *   - 13 dígitos (55 + DDD + 9 + 8)   → mantém + gera versão sem 9 (fallback)
 *
 * Retorna array vazio se input não parecer BR (deixa caller usar input cru).
 */
function brPhoneCandidates(digits: string): string[] {
  if (!digits) return [];
  const candidates: string[] = [];

  // 11 dígitos: DDD (2) + 9 (1) + 8 dígitos = celular moderno sem DDI
  if (digits.length === 11 && digits[2] === '9') {
    candidates.push('55' + digits);
    // Fallback legacy: tira o 9
    candidates.push('55' + digits.slice(0, 2) + digits.slice(3));
    return candidates;
  }

  // 10 dígitos: DDD (2) + 8 dígitos = celular legacy ou fixo sem DDI
  if (digits.length === 10) {
    // Adiciona 9 (assumindo celular)
    candidates.push('55' + digits.slice(0, 2) + '9' + digits.slice(2));
    // Fallback sem 9 (fixo ou legacy)
    candidates.push('55' + digits);
    return candidates;
  }

  // 13 dígitos: 55 + DDD + 9 + 8 = celular moderno completo
  if (digits.length === 13 && digits.startsWith('55') && digits[4] === '9') {
    candidates.push(digits);
    // Fallback legacy: 55 + DDD + 8
    candidates.push(digits.slice(0, 4) + digits.slice(5));
    return candidates;
  }

  // 12 dígitos: 55 + DDD + 8 = legacy completo
  if (digits.length === 12 && digits.startsWith('55')) {
    // Tenta primeiro com 9 (preferido moderno)
    candidates.push(digits.slice(0, 4) + '9' + digits.slice(4));
    candidates.push(digits);
    return candidates;
  }

  // Outros formatos (estrangeiros, números curtos, etc): mantém como veio
  candidates.push(digits);
  return candidates;
}
