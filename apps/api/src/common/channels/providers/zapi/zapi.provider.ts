import { Injectable, Logger } from '@nestjs/common';
import type {
  ChannelContactProfile,
  ChannelCredentials,
  ChannelProvider,
  ChannelType,
  Json,
  MessageContent,
  MessageDeliveryStatus,
  SendMediaInput,
  SendMessageInput,
  SendMessageResult,
  ValidationResult,
  WebhookEvent,
} from '@eclick-active/shared';
import type {
  ZapiCredentials,
  ZapiInboundPayload,
  ZapiSendResponse,
} from './zapi.types';

const ZAPI_BASE = 'https://api.z-api.io/instances';

@Injectable()
export class ZapiProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'whatsapp';

  private readonly logger = new Logger(ZapiProvider.name);

  // ──────────────────────────────────────────────────────────
  // OUTBOUND
  // ──────────────────────────────────────────────────────────

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const creds = this.requireCredentials(input.channel.credentials);
    const baseUrl = `${ZAPI_BASE}/${creds.instanceId}/token/${creds.token}`;
    const phone = input.to;

    // Resolve endpoint + body conforme content_type
    let endpoint: string;
    let body: Record<string, unknown>;

    switch (input.content_type) {
      case 'text': {
        const text = this.pickString(input.content, 'body');
        if (!text) {
          throw new Error("text content requires { body: string }");
        }
        endpoint = `${baseUrl}/send-text`;
        body = { phone, message: text };
        break;
      }
      case 'image': {
        const url = this.pickString(input.content, 'url');
        if (!url) throw new Error("image content requires { url: string }");
        const caption = this.pickString(input.content, 'caption');
        endpoint = `${baseUrl}/send-image`;
        body = { phone, image: url, ...(caption ? { caption } : {}) };
        break;
      }
      case 'audio': {
        const url = this.pickString(input.content, 'url');
        if (!url) throw new Error("audio content requires { url: string }");
        endpoint = `${baseUrl}/send-audio`;
        body = { phone, audio: url };
        break;
      }
      case 'video': {
        const url = this.pickString(input.content, 'url');
        if (!url) throw new Error("video content requires { url: string }");
        const caption = this.pickString(input.content, 'caption');
        endpoint = `${baseUrl}/send-video`;
        body = { phone, video: url, ...(caption ? { caption } : {}) };
        break;
      }
      case 'document': {
        const url = this.pickString(input.content, 'url');
        const filename = this.pickString(input.content, 'filename');
        if (!url || !filename) {
          throw new Error("document content requires { url, filename }");
        }
        endpoint = `${baseUrl}/send-document`;
        body = { phone, document: url, fileName: filename };
        break;
      }
      default:
        throw new Error(
          `Z-API does not support content_type=${input.content_type}`,
        );
    }

    if (input.reply_to_channel_message_id) {
      body.messageId = input.reply_to_channel_message_id;
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Z-API ${response.status} ${response.statusText}: ${text}`);
    }

    const data = (await response.json().catch(() => ({}))) as ZapiSendResponse;
    if (data.error) {
      throw new Error(`Z-API error: ${data.error}`);
    }

    return {
      channel_message_id: data.messageId ?? data.id ?? data.zaapId ?? `zapi-${Date.now()}`,
      status: 'sent',
    };
  }

  /** Wrapper sobre sendMessage — Z-API expõe os mesmos endpoints. */
  async sendMedia(input: SendMediaInput): Promise<SendMessageResult> {
    const content = {
      url: input.media_url,
      ...(input.caption ? { caption: input.caption } : {}),
      ...(input.mime_type ? { mime_type: input.mime_type } : {}),
      ...(input.filename ? { filename: input.filename } : {}),
    };
    return this.sendMessage({
      channel: input.channel,
      to: input.to,
      content_type: input.content_type,
      content: content as Json,
      reply_to_channel_message_id: input.reply_to_channel_message_id,
    });
  }

  // ──────────────────────────────────────────────────────────
  // INBOUND (parser do webhook)
  // ──────────────────────────────────────────────────────────

  /**
   * Normaliza o payload da Z-API em uma lista de `WebhookEvent`. Apenas
   * `ReceivedCallback` é traduzido em evento de mensagem; outros tipos
   * (DeliveryCallback, ReadCallback, etc.) viram eventos genéricos que o
   * webhook service decide ignorar ou processar depois.
   */
  async receiveWebhook(payload: unknown): Promise<WebhookEvent[]> {
    if (typeof payload !== 'object' || payload === null) return [];
    const p = payload as ZapiInboundPayload;

    if (p.isGroup) {
      // Mensagens de grupo não têm contato 1:1 — ignoramos por enquanto.
      return [];
    }

    if (p.type !== 'ReceivedCallback') {
      // Acks de delivery/read viriam aqui — escopo da Tarefa 3 só cobre inbound.
      return [
        {
          type: 'unknown',
          channel_id: '' as never, // resolvido pelo webhook service
          occurred_at: this.toISO(p.momment) ?? new Date().toISOString(),
          data: p as unknown as Json,
        },
      ];
    }

    const content = this.parseContent(p);
    if (!content) {
      this.logger.warn(`ZapiInbound: payload sem conteúdo reconhecível (type=${p.type})`);
      return [];
    }

    return [
      {
        type: 'message.received',
        channel_id: '' as never, // resolvido pelo webhook service via instanceId
        occurred_at: this.toISO(p.momment) ?? new Date().toISOString(),
        data: {
          phone: p.phone,
          channel_message_id: p.messageId,
          sender_name: p.senderName,
          avatar_url: p.photo ?? undefined,
          content_type: content.kind,
          content: content as unknown as Json,
        } as unknown as Json,
      },
    ];
  }

  // ──────────────────────────────────────────────────────────
  // STATUS / VALIDATE / PROFILE
  // ──────────────────────────────────────────────────────────

  async getMessageStatus(_channel_message_id: string): Promise<MessageDeliveryStatus> {
    // Z-API não tem endpoint estável de "get status" pra mensagem — o status
    // chega via DeliveryCallback / ReadCallback (webhooks). Quando esses
    // forem implementados, atualizamos a row de active.messages diretamente.
    throw new Error('Z-API: status updates chegam via webhook, não por GET');
  }

  async validateCredentials(credentials: ChannelCredentials): Promise<ValidationResult> {
    const c = credentials as Partial<ZapiCredentials>;
    if (!c.instanceId || !c.token) {
      return { valid: false, error: 'instanceId e token são obrigatórios' };
    }
    try {
      const response = await fetch(
        `${ZAPI_BASE}/${c.instanceId}/token/${c.token}/status`,
      );
      if (!response.ok) {
        return { valid: false, error: `${response.status} ${response.statusText}` };
      }
      const data = (await response.json().catch(() => ({}))) as {
        connected?: boolean;
        error?: string;
      };
      if (data.error) return { valid: false, error: data.error };
      return { valid: true, details: { connected: data.connected ?? null } };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async getContactProfile(_external_id: string): Promise<ChannelContactProfile | null> {
    // Z-API tem GET /contact-info/{phone} mas requer chamada extra por contato.
    // Por enquanto retornamos null — o senderName/photo do webhook já alimenta
    // o contato no findOrCreate.
    return null;
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  private requireCredentials(creds: ChannelCredentials): ZapiCredentials {
    const c = creds as Partial<ZapiCredentials>;
    if (!c.instanceId || !c.token) {
      throw new Error('Z-API: credenciais incompletas (instanceId/token ausentes)');
    }
    return { instanceId: c.instanceId, token: c.token, webhookUrl: c.webhookUrl };
  }

  private pickString(content: Json, key: string): string | undefined {
    if (typeof content !== 'object' || content === null || Array.isArray(content)) {
      return undefined;
    }
    const val = (content as Record<string, Json>)[key];
    return typeof val === 'string' ? val : undefined;
  }

  private toISO(momment: number | string | undefined): string | null {
    if (momment === undefined || momment === null) return null;
    const n = typeof momment === 'string' ? Number(momment) : momment;
    if (!Number.isFinite(n)) return null;
    // Z-API às vezes manda em segundos, às vezes em ms. Heurística: < 1e12 é segundos.
    const ms = n < 1_000_000_000_000 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }

  private parseContent(p: ZapiInboundPayload): MessageContent | null {
    const m = p.message;
    if (!m) return null;

    if (typeof m.text === 'string' && m.text.length > 0) {
      return { kind: 'text', body: m.text };
    }
    if (m.imageMessage) {
      return {
        kind: 'image',
        url: m.imageMessage.imageUrl,
        caption: m.imageMessage.caption,
        mime_type: m.imageMessage.mimeType,
      };
    }
    if (m.audioMessage) {
      return {
        kind: 'audio',
        url: m.audioMessage.audioUrl,
        duration_seconds: m.audioMessage.seconds,
        mime_type: m.audioMessage.mimeType,
      };
    }
    if (m.videoMessage) {
      return {
        kind: 'video',
        url: m.videoMessage.videoUrl,
        caption: m.videoMessage.caption,
        mime_type: m.videoMessage.mimeType,
      };
    }
    if (m.documentMessage) {
      return {
        kind: 'document',
        url: m.documentMessage.documentUrl,
        filename: m.documentMessage.fileName,
        mime_type: m.documentMessage.mimeType,
      };
    }
    if (m.locationMessage) {
      return {
        kind: 'location',
        latitude: m.locationMessage.latitude,
        longitude: m.locationMessage.longitude,
        name: m.locationMessage.name,
        address: m.locationMessage.address,
      };
    }
    if (m.stickerMessage) {
      return { kind: 'sticker', url: m.stickerMessage.stickerUrl };
    }
    return null;
  }
}
