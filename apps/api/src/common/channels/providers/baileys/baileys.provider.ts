import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
import type {
  ChannelContactProfile,
  ChannelCredentials,
  ChannelProvider,
  ChannelType,
  MessageDeliveryStatus,
  SendMediaInput,
  SendMessageInput,
  SendMessageResult,
  ValidationResult,
  WebhookEvent,
} from '@eclick-active/shared';

/**
 * Provider de WhatsApp via Baileys (protocolo Web). Diferente do ZapiProvider,
 * a sessão real (WebSocket persistente com servidores do WhatsApp) vive em
 * `apps/workers` — esse provider no API é só uma "casca" pro dispatcher
 * conhecer o channel_type='whatsapp_free'.
 *
 * MVP: outbound (sendMessage) está stub. A entrada no banco é feita pelo
 * worker direto via service_role; o socket.io broadcast (whatsapp:qr / connected
 * / disconnected) é feito via POST /internal/realtime.
 */
@Injectable()
export class BaileysProvider implements ChannelProvider {
  readonly channel_type: ChannelType = 'whatsapp_free';

  private readonly logger = new Logger(BaileysProvider.name);

  async sendMessage(_input: SendMessageInput): Promise<SendMessageResult> {
    // TODO(baileys-outbound): proxiar pro worker via HTTP. O worker mantém
    // a sessão Baileys em memória e expõe `POST /internal/baileys/send`.
    throw new NotImplementedException(
      'Baileys outbound ainda não implementado no MVP. Use Z-API pra enviar.',
    );
  }

  async sendMedia(_input: SendMediaInput): Promise<SendMessageResult> {
    throw new NotImplementedException('Baileys sendMedia: ver TODO(baileys-outbound)');
  }

  async receiveWebhook(_payload: unknown): Promise<WebhookEvent[]> {
    // Baileys NÃO usa webhooks — mensagens chegam direto pelo socket no worker
    // e o worker insere em active.messages via service_role. Esse método existe
    // só pra satisfazer a interface ChannelProvider.
    return [];
  }

  async getMessageStatus(_id: string): Promise<MessageDeliveryStatus> {
    // Baileys não tem GET status — chega via evento `messages.update` no socket.
    return 'sent';
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
