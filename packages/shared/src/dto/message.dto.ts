import type { Json, UUID } from '../types/common';
import type { MessageContentType, MessageSenderType } from '../enums';

/**
 * Payload de envio de mensagem (POST /conversations/:id/messages).
 * O backend traduz isso em uma chamada `ChannelProvider.sendMessage()`.
 */
export interface SendMessageDto {
  content_type: MessageContentType;
  content: Json;
  /** Default: 'agent' (mensagem do operador). Use 'bot' para auto-respond. */
  sender_type?: MessageSenderType;
  /** ID do template aprovado (obrigatório fora da janela de 24h no WhatsApp) */
  template_id?: UUID;
  /** Variáveis pra substituir no template */
  template_variables?: Record<string, string>;
  /** ID externo da mensagem citada (reply) */
  reply_to_channel_message_id?: string;
  /** Marca como nota interna (não entrega ao contato) */
  is_internal_note?: boolean;
}

/** Payload de upload de mídia antes do envio (POST /messages/upload) */
export interface UploadMediaDto {
  /** Multipart form-data field name: `file` */
  filename: string;
  mime_type: string;
  size_bytes: number;
}

export interface UploadMediaResponse {
  media_url: string;
  media_id: UUID;
  expires_at: string;
}
