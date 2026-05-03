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
  TikTokCommentReplyResponse,
  TikTokCredentials,
  TikTokTokenResponse,
  TikTokUserInfo,
  TikTokWebhookBody,
} from './tiktok.types';

const TIKTOK_OAUTH_AUTHORIZE = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_OAUTH_TOKEN = 'https://open.tiktokapis.com/v2/oauth/token/';
const TIKTOK_API = 'https://open.tiktokapis.com/v2';

const TIKTOK_SCOPES = [
  'user.info.basic',
  'user.info.profile',
  'video.list',
  'comment.list',
  'comment.list.manage',
].join(',');

/**
 * Provider TikTok — Cenário A (comentários/follows via webhook).
 *
 * sendMessage:
 *   - Quando reply a comment: POST /v2/comment/reply (limite 150 chars,
 *     valida no caller). Outros tipos não suportados ainda.
 *   - Quando TikTok liberar Business Messages, plugar dm aqui.
 *
 * receiveWebhook: parseia comment.create / comment.reply / follow.
 *   Outros eventos (video.publish, like.add, etc.) ignorados na v1.
 *
 * validateCredentials: GET /user/info testa token.
 */
@Injectable()
export class TikTokProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'tiktok';
  private readonly logger = new Logger(TikTokProvider.name);

  // ──────────────────────────────────────────────────────────
  // OUTBOUND — comment reply (única ação disponível na v1)
  // ──────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const creds = this.requireCredentials(input.channel.credentials);

    // Determina ação a partir do metadata.kind (comment_reply | dm)
    const meta = input.channel.config as Record<string, unknown> | null;
    const replyToCommentId = this.pickString(input.content, 'comment_id');
    const videoId = this.pickString(input.content, 'video_id');
    const text = this.pickString(input.content, 'body') ?? this.pickString(input.content, 'text');

    if (!replyToCommentId || !videoId || !text) {
      throw new Error('TikTok sendMessage requer { comment_id, video_id, body }');
    }

    // Validação cliente: TikTok limita reply a 150 chars
    if (text.length > 150) {
      throw new Error('TikTok comment reply: máximo 150 caracteres');
    }

    const res = await fetch(`${TIKTOK_API}/comment/reply/`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${creds.access_token_encrypted}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        video_id: videoId,
        comment_id: replyToCommentId,
        text,
      }),
    });

    if (!res.ok) {
      const t = await res.text();
      this.logger.error(`TikTok reply falhou ${res.status}: ${t}`);
      throw new Error(`TikTok API error ${res.status}: ${t}`);
    }

    const json = (await res.json()) as TikTokCommentReplyResponse;
    if (json.error) {
      throw new Error(`TikTok error ${json.error.code}: ${json.error.message}`);
    }

    return {
      channel_message_id: json.data?.comment?.comment_id ?? `tk-reply-${Date.now()}`,
      status: 'sent',
    };
  }

  async sendMedia(_input: SendMediaInput): Promise<SendMessageResult> {
    throw new Error('TikTok não suporta envio de mídia em comments — use texto puro');
  }

  // ──────────────────────────────────────────────────────────
  // INBOUND — webhook
  // ──────────────────────────────────────────────────────────

  async receiveWebhook(payload: unknown): Promise<WebhookEvent[]> {
    const body = payload as TikTokWebhookBody | undefined;
    if (!body || !body.event) return [];

    const occurredAt = new Date((body.create_time ?? Date.now() / 1000) * 1000).toISOString();
    const events: WebhookEvent[] = [];

    switch (body.event) {
      case 'comment.create':
      case 'comment.reply':
        events.push({
          type: 'message.received',
          channel_id: body.to_user_id ?? '', // será resolvido pra UUID via service
          occurred_at: occurredAt,
          data: {
            interaction_type: body.event === 'comment.reply' ? 'comment' : 'comment',
            user_open_id: body.user_open_id ?? null,
            to_user_id: body.to_user_id ?? null,
            content: body.content ?? '',
            video_id: body.video_id ?? null,
            video_url: body.video_url ?? null,
            comment_id: body.comment_id ?? null,
            parent_comment_id: body.parent_comment_id ?? null,
            username: body.username ?? null,
            user_avatar_url: body.user_avatar_url ?? null,
          } as unknown as Json,
        });
        break;

      case 'follow':
        events.push({
          type: 'contact.profile_updated',
          channel_id: body.to_user_id ?? '',
          occurred_at: occurredAt,
          data: {
            interaction_type: 'follow',
            user_open_id: body.user_open_id ?? null,
            to_user_id: body.to_user_id ?? null,
            username: body.username ?? null,
            user_avatar_url: body.user_avatar_url ?? null,
          } as unknown as Json,
        });
        break;

      // TODO: dm.receive quando TikTok liberar Business Messages
      default:
        this.logger.debug(`TikTok webhook event ignorado: ${body.event}`);
    }

    return events;
  }

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    return 'sent';
  }

  // ──────────────────────────────────────────────────────────
  // VALIDATION
  // ──────────────────────────────────────────────────────────

  async validateCredentials(creds: ChannelCredentials): Promise<ValidationResult> {
    const c = creds as unknown as TikTokCredentials;
    if (!c.access_token_encrypted || !c.open_id) {
      return { valid: false, error: 'Credenciais incompletas (access_token + open_id)' };
    }

    let token: string | null;
    try {
      token = this.decryptIfNeeded(c.access_token_encrypted);
    } catch (err) {
      return {
        valid: false,
        error: `Falha ao descriptografar: ${err instanceof Error ? err.message : ''}`,
      };
    }
    if (!token) return { valid: false, error: 'Token vazio' };

    try {
      const res = await fetch(
        `${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,display_name,username`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) {
        return { valid: false, error: `User info falhou: ${await res.text()}` };
      }
      const json = (await res.json()) as { data?: { user?: TikTokUserInfo } };
      const u = json.data?.user;
      if (!u) return { valid: false, error: 'Resposta inválida' };
      return {
        valid: true,
        details: { open_id: u.open_id, username: u.username, display_name: u.display_name },
      };
    } catch (err) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Erro de rede',
      };
    }
  }

  async getContactProfile(_externalId: string): Promise<ChannelContactProfile | null> {
    // TikTok Display API não permite buscar perfil de outro usuário sem token
    // dele. O webhook já manda username + avatar — usamos isso direto.
    return null;
  }

  // ──────────────────────────────────────────────────────────
  // OAuth helpers
  // ──────────────────────────────────────────────────────────

  buildAuthUrl(args: {
    client_key: string;
    redirect_uri: string;
    state: string;
  }): string {
    const params = new URLSearchParams({
      client_key: args.client_key,
      scope: TIKTOK_SCOPES,
      redirect_uri: args.redirect_uri,
      response_type: 'code',
      state: args.state,
    });
    return `${TIKTOK_OAUTH_AUTHORIZE}?${params.toString()}`;
  }

  async exchangeCodeForToken(args: {
    code: string;
    redirect_uri: string;
    client_key: string;
    client_secret: string;
  }): Promise<TikTokTokenResponse> {
    const res = await fetch(TIKTOK_OAUTH_TOKEN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: args.client_key,
        client_secret: args.client_secret,
        code: args.code,
        grant_type: 'authorization_code',
        redirect_uri: args.redirect_uri,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`TikTok token exchange falhou: ${await res.text()}`);
    }
    return (await res.json()) as TikTokTokenResponse;
  }

  async refreshAccessToken(args: {
    refresh_token: string;
    client_key: string;
    client_secret: string;
  }): Promise<TikTokTokenResponse> {
    const res = await fetch(TIKTOK_OAUTH_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_key: args.client_key,
        client_secret: args.client_secret,
        grant_type: 'refresh_token',
        refresh_token: args.refresh_token,
      }).toString(),
    });
    if (!res.ok) {
      throw new Error(`TikTok refresh falhou: ${await res.text()}`);
    }
    return (await res.json()) as TikTokTokenResponse;
  }

  async fetchUserInfo(accessToken: string): Promise<TikTokUserInfo | null> {
    const res = await fetch(
      `${TIKTOK_API}/user/info/?fields=open_id,union_id,avatar_url,avatar_url_100,display_name,username,profile_deep_link`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { user?: TikTokUserInfo } };
    return json.data?.user ?? null;
  }

  // ──────────────────────────────────────────────────────────
  // Polling fallback (quando webhook não está disponível)
  // ──────────────────────────────────────────────────────────

  /**
   * Lista comentários novos dos últimos N vídeos do business. Usado
   * pelo TikTokPollerService como fallback se webhooks não foram
   * habilitados pra essa conta.
   *
   * Limite 100 comments por chamada — TikTok rate limit ~50-100/min.
   */
  async fetchRecentComments(
    accessToken: string,
    videoId: string,
    sinceTime?: number,
  ): Promise<
    Array<{
      comment_id: string;
      text: string;
      create_time: number;
      user: { open_id: string; username: string; avatar_url: string };
    }>
  > {
    const params = new URLSearchParams({
      video_id: videoId,
      max_count: '100',
    });
    const res = await fetch(`${TIKTOK_API}/comment/list/?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      this.logger.warn(`fetchRecentComments falhou: ${await res.text()}`);
      return [];
    }
    const json = (await res.json()) as {
      data?: { comments?: Array<{ comment_id: string; text: string; create_time: number; user: { open_id: string; username: string; avatar_url: string } }> };
    };
    const comments = json.data?.comments ?? [];
    if (sinceTime) {
      return comments.filter((c) => c.create_time > sinceTime);
    }
    return comments;
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /** Versão pública pra services externos (poller/AI) acessarem credenciais decryptadas. */
  decryptCredentials(creds: ChannelCredentials | null): TikTokCredentials {
    return this.requireCredentials(creds);
  }

  private requireCredentials(creds: ChannelCredentials | null): TikTokCredentials {
    if (!creds) throw new Error('Channel sem credentials');
    const c = creds as unknown as TikTokCredentials;
    if (!c.access_token_encrypted || !c.open_id) {
      throw new Error('TikTok credentials incompletas');
    }
    const accessToken = this.decryptIfNeeded(c.access_token_encrypted);
    if (!accessToken) {
      throw new Error('Falha ao descriptografar access_token — reconecte');
    }
    const refreshToken = c.refresh_token_encrypted
      ? this.decryptIfNeeded(c.refresh_token_encrypted)
      : '';
    return {
      ...c,
      access_token_encrypted: accessToken,
      refresh_token_encrypted: refreshToken ?? '',
    };
  }

  private decryptIfNeeded(value: string): string | null {
    const isEncrypted = value.includes(':') && value.split(':').length === 3;
    if (!isEncrypted) return value;
    return decryptToken(value);
  }

  private pickString(obj: unknown, key: string): string | undefined {
    if (!obj || typeof obj !== 'object') return undefined;
    const v = (obj as Record<string, unknown>)[key];
    return typeof v === 'string' ? v : undefined;
  }
}
