import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotImplementedException,
  ServiceUnavailableException,
} from '@nestjs/common';
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

/**
 * Provider de WhatsApp via Baileys (protocolo Web). A sessão real (WebSocket
 * persistente com servidores do WhatsApp) vive em `apps/workers` — esse
 * provider faz proxy HTTP pra `POST /internal/baileys/send` no worker.
 *
 * Auth: header `X-Internal-Key` (mesma chave que o worker usa pra chamar
 * `POST /internal/realtime` na API — `INTERNAL_API_KEY` em ambos `.env`).
 */
@Injectable()
export class BaileysProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'whatsapp_free';

  private readonly logger = new Logger(BaileysProvider.name);

  async sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
    const url = process.env.WORKER_INTERNAL_URL;
    const key = process.env.INTERNAL_API_KEY;
    if (!url || !key) {
      throw new InternalServerErrorException(
        'Baileys: WORKER_INTERNAL_URL/INTERNAL_API_KEY não configurados — não é possível enviar.',
      );
    }

    const body = {
      channel_id: input.channel.id,
      to: input.to,
      content_type: input.content_type,
      content: input.content,
    };

    let response: Response;
    try {
      response = await fetch(`${url}/internal/baileys/send`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Key': key,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // ECONNREFUSED quando o worker está caído / outra porta
      throw new BadGatewayException(
        `Baileys: worker inalcançável (${err instanceof Error ? err.message : String(err)})`,
      );
    }

    const data = (await response.json().catch(() => ({}))) as {
      message_id?: string;
      error?: string;
      detail?: string;
    };

    if (!response.ok) {
      const detail = data.detail ?? data.error ?? `${response.status} ${response.statusText}`;
      // 404 = canal não tem sessão; 503 = sessão existe mas socket fechado
      if (response.status === 404) {
        throw new ServiceUnavailableException(
          `Baileys: canal sem sessão ativa no worker — escaneie o QR. (${detail})`,
        );
      }
      if (response.status === 503) {
        throw new ServiceUnavailableException(
          `Baileys: sessão ainda não pronta — aguarde reconexão. (${detail})`,
        );
      }
      throw new InternalServerErrorException(`Baileys: ${detail}`);
    }

    if (!data.message_id) {
      throw new InternalServerErrorException(
        'Baileys: resposta do worker sem message_id',
      );
    }

    return {
      channel_message_id: data.message_id,
      status: 'sent',
    };
  }

  async sendMedia(input: SendMediaInput): Promise<SendMessageResult> {
    const content: Record<string, unknown> = {
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

  async receiveWebhook(_payload: unknown): Promise<WebhookEvent[]> {
    // Baileys NÃO usa webhooks — mensagens chegam direto pelo socket no worker
    // e o worker insere em active.messages via service_role. Esse método existe
    // só pra satisfazer a interface ChannelProvider.
    return [];
  }

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    // Baileys não tem GET status — chega via evento `messages.update` no socket.
    throw new NotImplementedException(
      'Baileys: status updates chegam via socket events, não por GET',
    );
  }

  async validateCredentials(creds: ChannelCredentials): Promise<ValidationResult> {
    // Pra Baileys, "credentials válidas" = ter auth state de sessão prévia.
    // Sem auth state, o canal precisa parear via QR (status='pending').
    const hasAuth =
      creds && typeof creds === 'object' && 'baileys_auth' in creds;
    return hasAuth
      ? { valid: true, details: { has_session: true } }
      : { valid: false, error: 'Sessão não pareada — escaneie o QR code' };
  }

  async getContactProfile(_externalId: string): Promise<ChannelContactProfile | null> {
    // Worker já enriquece contato via Baileys.fetchStatus / pushName ao receber
    // mensagem. Esse método não é chamado no fluxo atual.
    return null;
  }
}
