/**
 * Tipos específicos da Z-API. Não vai pro shared porque é detalhe de
 * implementação do provider — frontend não precisa saber disso.
 */

/** Shape esperado em `active.channels.credentials` quando channel_type='whatsapp' via Z-API. */
export interface ZapiCredentials {
  instanceId: string;
  token: string;
  /** Opcional — só pra documentação/debug, não é usado em runtime. */
  webhookUrl?: string;
}

// ──────────────────────────────────────────────────────────
// Webhook payload (formato da Z-API)
// ──────────────────────────────────────────────────────────

export type ZapiCallbackType =
  | 'ReceivedCallback'
  | 'DeliveryCallback'
  | 'ReadCallback'
  | 'MessageStatusCallback'
  | 'PresenceChatCallback'
  | string; // Z-API pode adicionar tipos novos

/** Mensagem de TEXTO simples — o payload tem `message.text`. */
export interface ZapiTextContent {
  text?: string;
  imageMessage?: ZapiImageContent;
  audioMessage?: ZapiAudioContent;
  videoMessage?: ZapiVideoContent;
  documentMessage?: ZapiDocumentContent;
  locationMessage?: ZapiLocationContent;
  stickerMessage?: ZapiStickerContent;
}

export interface ZapiImageContent {
  imageUrl: string;
  caption?: string;
  mimeType?: string;
  /** Hash/checksum opcional usado pra deduplicação no lado da Z-API */
  fileSha256?: string;
}

export interface ZapiAudioContent {
  audioUrl: string;
  mimeType?: string;
  /** Duração em segundos — Z-API às vezes envia */
  seconds?: number;
}

export interface ZapiVideoContent {
  videoUrl: string;
  caption?: string;
  mimeType?: string;
}

export interface ZapiDocumentContent {
  documentUrl: string;
  fileName: string;
  mimeType?: string;
}

export interface ZapiLocationContent {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface ZapiStickerContent {
  stickerUrl: string;
  mimeType?: string;
}

/** Payload completo que a Z-API POSTa pra `/webhooks/zapi`. */
export interface ZapiInboundPayload {
  type: ZapiCallbackType;
  instanceId: string;
  /** Telefone do contato no formato internacional sem '+', ex: "5571999999999" */
  phone: string;
  isGroup: boolean;
  /** ID da mensagem na Z-API */
  messageId?: string;
  /** Timestamp Unix (segundos OU ms — Z-API varia). Pode vir como number ou string. */
  momment?: number | string;
  /** Avatar do contato (URL pública) */
  photo?: string | null;
  /** Nome exibido pelo WhatsApp do contato */
  senderName?: string;
  /** Conteúdo da mensagem — varia por tipo. Só presente em ReceivedCallback. */
  message?: ZapiTextContent;
  /** Reply: ID da mensagem citada */
  referenceMessageId?: string;
}

/** Resposta padrão dos endpoints `/send-*` da Z-API. Campos podem variar. */
export interface ZapiSendResponse {
  /** Algumas chamadas retornam `id`, outras `messageId` ou `zaapId` */
  id?: string;
  messageId?: string;
  zaapId?: string;
  /** Em caso de erro a Z-API costuma retornar `error: string` */
  error?: string;
}
