import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelContactProfile,
  ChannelCredentials,
  ChannelProvider,
  ChannelType,
  Json,
  MessageDeliveryStatus,
  SendMediaInput,
  SendMessageInput,
  SendMessageResult,
  ValidationResult,
  WebhookEvent,
} from '@eclick-active/shared';
import { decryptToken } from '../../../../modules/calendar-integrations/crypto.helper';
import type {
  InstagramCredentials,
  InstagramMessagingEvent,
  InstagramSendResponse,
  InstagramWebhookBody,
} from './instagram.types';

const GRAPH_API = 'https://graph.facebook.com/v21.0';

/**
 * Provider Instagram Direct via Messenger Platform (Meta Graph API).
 *
 * Endpoints principais:
 *   - POST /{ig_user_id}/messages    → enviar DM
 *   - GET  /me?access_token=...      → validar credenciais
 *   - GET  /{psid}                   → perfil do usuário (limitado)
 *
 * Webhooks chegam em /webhooks/instagram (controller separado), que
 * delega aqui pra normalização via receiveWebhook().
 */
@Injectable()
export class InstagramProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'instagram';
  private readonly logger = new Logger(InstagramProvider.name);

  // ──────────────────────────────────────────────────────────
  // OUTBOUND — POST /{ig_user_id}/messages
  // ──────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const creds = this.requireCredentials(input.channel.credentials);
    const url = `${GRAPH_API}/${creds.ig_user_id}/messages`;

    let payload: Record<string, unknown>;

    switch (input.content_type) {
      case 'text': {
        const text = this.pickString(input.content, 'body');
        if (!text) throw new Error('text content requires { body: string }');
        payload = {
          recipient: { id: input.to },
          message: { text },
        };
        break;
      }
      case 'image':
      case 'video':
      case 'audio':
      case 'document': {
        const mediaUrl = this.pickString(input.content, 'url');
        if (!mediaUrl) throw new Error(`${input.content_type} requires { url: string }`);
        const attachmentType =
          input.content_type === 'document' ? 'file' : input.content_type;
        payload = {
          recipient: { id: input.to },
          message: {
            attachment: {
              type: attachmentType,
              payload: { url: mediaUrl, is_reusable: true },
            },
          },
        };
        break;
      }
      default:
        throw new Error(`Instagram não suporta content_type=${input.content_type}`);
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.page_access_token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      this.logger.error(`Instagram send falhou ${res.status}: ${text}`);
      throw new Error(`Instagram API error ${res.status}: ${text}`);
    }

    const json = (await res.json()) as InstagramSendResponse;
    if (json.error) {
      throw new Error(`Instagram error ${json.error.code}: ${json.error.message}`);
    }
    return {
      channel_message_id: json.message_id,
      status: 'sent',
    };
  }

  async sendMedia(input: SendMediaInput): Promise<SendMessageResult> {
    const ct = this.guessContentType(input.media_url, input.mime_type);
    return this.sendMessage({
      channel: input.channel,
      to: input.to,
      content_type: ct,
      content: {
        url: input.media_url,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.filename ? { filename: input.filename } : {}),
      } as unknown as Json,
      ...(input.reply_to_channel_message_id
        ? { reply_to_channel_message_id: input.reply_to_channel_message_id }
        : {}),
    });
  }

  // ──────────────────────────────────────────────────────────
  // INBOUND — receiveWebhook
  // ──────────────────────────────────────────────────────────

  async receiveWebhook(payload: unknown): Promise<WebhookEvent[]> {
    const body = payload as InstagramWebhookBody | undefined;
    if (!body || body.object !== 'instagram' || !Array.isArray(body.entry)) {
      return [];
    }

    const events: WebhookEvent[] = [];

    for (const entry of body.entry) {
      const igUserId = entry.id;
      const messaging = entry.messaging ?? [];

      for (const m of messaging) {
        // Echoes — mensagens que NÓS enviamos vêm de volta. Ignora.
        if (m.message?.is_echo) continue;

        if (m.message) {
          events.push(this.normalizeIncomingMessage(igUserId, m));
        } else if (m.delivery) {
          // Delivery receipts — atualiza status pra 'delivered'
          const mids = m.delivery.mids ?? [];
          for (const mid of mids) {
            events.push({
              type: 'message.status',
              channel_id: igUserId, // resolveremos UUID via service
              occurred_at: new Date(m.timestamp).toISOString(),
              data: {
                channel_message_id: mid,
                status: 'delivered' as MessageDeliveryStatus,
              } as unknown as Json,
            });
          }
        } else if (m.read) {
          // Read receipts — Instagram só manda watermark (todas até X são lidas)
          events.push({
            type: 'message.status',
            channel_id: igUserId,
            occurred_at: new Date(m.timestamp).toISOString(),
            data: {
              read_watermark: m.read.watermark,
              status: 'read' as MessageDeliveryStatus,
              recipient_id: m.recipient.id,
            } as unknown as Json,
          });
        }
        // reaction, postback, etc. ignorados na v1
      }
    }

    return events;
  }

  private normalizeIncomingMessage(
    igUserId: string,
    m: InstagramMessagingEvent,
  ): WebhookEvent {
    const msg = m.message!;
    const occurredAt = new Date(m.timestamp).toISOString();

    // Decide content_type a partir dos attachments
    let contentType: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text';
    let content: Record<string, unknown> = { body: msg.text ?? '' };
    let extra: Record<string, unknown> = {};

    const att = msg.attachments?.[0];
    if (att) {
      switch (att.type) {
        case 'image':
          contentType = 'image';
          content = {
            url: att.payload.url ?? null,
            ...(msg.text ? { caption: msg.text } : {}),
          };
          break;
        case 'video':
          contentType = 'video';
          content = {
            url: att.payload.url ?? null,
            ...(msg.text ? { caption: msg.text } : {}),
          };
          break;
        case 'audio':
          contentType = 'audio';
          content = { url: att.payload.url ?? null };
          break;
        case 'file':
          contentType = 'document';
          content = { url: att.payload.url ?? null, filename: 'arquivo' };
          break;
        case 'story_mention':
          contentType = 'image';
          content = {
            url: att.payload.url ?? null,
            caption: msg.text ?? '(mencionou você no story)',
          };
          extra = { instagram_event: 'story_mention' };
          break;
        case 'share':
          contentType = 'text';
          content = { body: msg.text ?? '(compartilhou um post)' };
          extra = { instagram_event: 'share', shared_url: att.payload.url };
          break;
        default:
          contentType = 'text';
          content = { body: msg.text ?? `(${att.type})` };
      }
    }

    // is_unsupported = anexo que não conseguimos baixar (ex: voice anônimo)
    if (msg.is_unsupported) {
      extra.instagram_unsupported = true;
    }

    return {
      type: 'message.received',
      channel_id: igUserId, // será resolvido pra UUID do canal no service
      occurred_at: occurredAt,
      data: {
        sender_id: m.sender.id,
        recipient_id: m.recipient.id,
        channel_message_id: msg.mid,
        content_type: contentType,
        content,
        text: msg.text ?? null,
        reply_to: msg.reply_to?.mid ?? null,
        ig_user_id: igUserId,
        ...extra,
      } as unknown as Json,
    };
  }

  // ──────────────────────────────────────────────────────────
  // STATUS
  // ──────────────────────────────────────────────────────────

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    // Instagram não expõe endpoint pra consultar status de mensagem específica.
    // Status vem só via webhook (delivery/read receipts).
    return 'sent';
  }

  // ──────────────────────────────────────────────────────────
  // VALIDATION + PROFILE
  // ──────────────────────────────────────────────────────────

  async validateCredentials(credentials: ChannelCredentials): Promise<ValidationResult> {
    const creds = credentials as unknown as InstagramCredentials;
    if (!creds.page_access_token || !creds.ig_user_id) {
      return { valid: false, error: 'Credenciais incompletas (page_access_token + ig_user_id)' };
    }
    try {
      const res = await fetch(
        `${GRAPH_API}/me?access_token=${encodeURIComponent(creds.page_access_token)}`,
      );
      if (!res.ok) {
        const text = await res.text();
        return { valid: false, error: `Token inválido: ${text}` };
      }
      const json = (await res.json()) as { id: string; name: string };
      return { valid: true, details: { page_id: json.id, page_name: json.name } };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Erro de rede',
      };
    }
  }

  /**
   * Busca perfil do usuário IG. Limitação Meta: só retorna name + profile_pic
   * pra usuários que enviaram DM. Pra outros, retorna 400.
   */
  async getContactProfile(externalId: string): Promise<ChannelContactProfile | null> {
    // Esse método é chamado SEM credentials no contrato — pra Instagram precisamos
    // do token. Caller (webhook service) deve chamar fetchProfile diretamente
    // passando creds. Aqui retornamos null pra fallback gracioso.
    return null;
  }

  /** Versão com credentials — usada pelo webhook service. */
  async fetchProfile(
    creds: InstagramCredentials,
    psid: string,
  ): Promise<ChannelContactProfile | null> {
    try {
      const res = await fetch(
        `${GRAPH_API}/${psid}?fields=name,profile_pic&access_token=${encodeURIComponent(creds.page_access_token)}`,
      );
      if (!res.ok) {
        this.logger.debug(`fetchProfile ${psid} retornou ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { id: string; name?: string; profile_pic?: string };
      return {
        external_id: json.id,
        ...(json.name ? { name: json.name } : {}),
        ...(json.profile_pic ? { avatar_url: json.profile_pic } : {}),
      };
    } catch {
      return null;
    }
  }

  // ──────────────────────────────────────────────────────────
  // OAuth helpers (chamados pelo OAuth controller)
  // ──────────────────────────────────────────────────────────

  /** Troca code → short-lived token. */
  async exchangeCodeForToken(args: {
    code: string;
    redirect_uri: string;
    client_id: string;
    client_secret: string;
  }): Promise<{ access_token: string; expires_in?: number }> {
    const params = new URLSearchParams({
      client_id: args.client_id,
      client_secret: args.client_secret,
      redirect_uri: args.redirect_uri,
      code: args.code,
    });
    const res = await fetch(`${GRAPH_API}/oauth/access_token?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Token exchange falhou: ${await res.text()}`);
    }
    return (await res.json()) as { access_token: string; expires_in?: number };
  }

  /** Troca short-lived (1h) → long-lived (60d). */
  async exchangeForLongLivedToken(args: {
    short_lived_token: string;
    client_id: string;
    client_secret: string;
  }): Promise<{ access_token: string; expires_in: number }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: args.client_id,
      client_secret: args.client_secret,
      fb_exchange_token: args.short_lived_token,
    });
    const res = await fetch(`${GRAPH_API}/oauth/access_token?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Long-lived exchange falhou: ${await res.text()}`);
    }
    return (await res.json()) as { access_token: string; expires_in: number };
  }

  /** Lista pages do user + IG business account associado. */
  async listUserPages(userAccessToken: string): Promise<Array<{
    page_id: string;
    page_name: string;
    page_access_token: string;
    ig_user_id: string | null;
    ig_username: string | null;
  }>> {
    const res = await fetch(
      `${GRAPH_API}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(userAccessToken)}`,
    );
    if (!res.ok) throw new Error(`Listar pages falhou: ${await res.text()}`);
    const json = (await res.json()) as {
      data: Array<{
        id: string;
        name: string;
        access_token: string;
        instagram_business_account?: { id: string };
      }>;
    };

    // Pra cada page com IG, busca o username
    const out: Array<{
      page_id: string;
      page_name: string;
      page_access_token: string;
      ig_user_id: string | null;
      ig_username: string | null;
    }> = [];
    for (const p of json.data) {
      const igId = p.instagram_business_account?.id ?? null;
      let username: string | null = null;
      if (igId) {
        try {
          const r = await fetch(
            `${GRAPH_API}/${igId}?fields=username&access_token=${encodeURIComponent(p.access_token)}`,
          );
          if (r.ok) {
            const j = (await r.json()) as { username?: string };
            username = j.username ?? null;
          }
        } catch {
          // ignore
        }
      }
      out.push({
        page_id: p.id,
        page_name: p.name,
        page_access_token: p.access_token,
        ig_user_id: igId,
        ig_username: username,
      });
    }
    return out;
  }

  /**
   * Inscreve a page no webhook do messaging — é ISTO que faz as DMs
   * chegarem. Sem a inscrição, o canal fica "conectado" e mudo.
   *
   * Devolve o erro em vez de só logar: antes isto era um `logger.warn`
   * silencioso, e a causa mais comum de falha é permissão que falta
   * (`pages_manage_metadata`). O lojista via "Instagram conectado com
   * sucesso" e ficava esperando mensagens que nunca chegariam — sem
   * nenhuma pista do motivo. Quem chama junta os erros e mostra.
   */
  async subscribePageToWebhook(
    pageId: string,
    pageAccessToken: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const res = await fetch(
        `${GRAPH_API}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,messaging_reactions&access_token=${encodeURIComponent(pageAccessToken)}`,
        { method: 'POST' },
      );
      if (!res.ok) {
        const raw = await res.text();
        let msg = raw;
        try {
          const j = JSON.parse(raw) as { error?: { message?: string; code?: number } };
          if (j.error?.message) {
            msg = j.error.message;
            // #200 = falta permissão. Traduz pra algo acionável em vez de
            // repassar o texto cru da Meta.
            if (j.error.code === 200) {
              msg = 'faltou a permissão pages_manage_metadata — reconecte autorizando o acesso às Páginas';
            }
          }
        } catch {
          /* resposta não-JSON: usa o texto cru */
        }
        this.logger.warn(`subscribed_apps falhou pra page ${pageId}: ${msg}`);
        return { ok: false, error: msg };
      }
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`subscribed_apps falhou pra page ${pageId}: ${msg}`);
      return { ok: false, error: msg };
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Resolve credentials descriptografando o page_access_token. Token é
   * gravado via OAuth controller já criptografado (AES-256-GCM); aqui
   * descriptografamos antes de chamar a API.
   */
  private requireCredentials(creds: ChannelCredentials | null): InstagramCredentials {
    if (!creds) throw new Error('Channel sem credentials');
    const c = creds as unknown as InstagramCredentials;
    if (!c.page_access_token || !c.ig_user_id) {
      throw new Error('Instagram credentials incompletas');
    }
    // Detecta formato encriptado (iv:tag:cipher) e descriptografa.
    const isEncrypted = c.page_access_token.includes(':') && c.page_access_token.split(':').length === 3;
    const decrypted = isEncrypted ? decryptToken(c.page_access_token) : c.page_access_token;
    if (!decrypted) {
      throw new Error('Falha ao descriptografar token Instagram — reconecte');
    }
    return { ...c, page_access_token: decrypted };
  }

  /** Versão pública pro webhook service descriptografar antes de chamar fetchProfile. */
  decryptCredentials(creds: ChannelCredentials | null): InstagramCredentials {
    return this.requireCredentials(creds);
  }

  private pickString(obj: unknown, key: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }

  private guessContentType(
    url: string,
    mime?: string,
  ): 'image' | 'video' | 'audio' | 'document' {
    const m = (mime ?? '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m.startsWith('video/')) return 'video';
    if (m.startsWith('audio/')) return 'audio';
    const u = url.toLowerCase();
    if (/\.(jpg|jpeg|png|gif|webp)(\?|$)/.test(u)) return 'image';
    if (/\.(mp4|mov|webm|m4v)(\?|$)/.test(u)) return 'video';
    if (/\.(mp3|m4a|ogg|aac|wav)(\?|$)/.test(u)) return 'audio';
    return 'document';
  }
}
