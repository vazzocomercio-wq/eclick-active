import type { Json, UUID, ISODateString } from './common';
import type {
  ChannelType,
  ChannelStatus,
  MessageDeliveryStatus,
  MessageContentType,
} from '../enums';

/**
 * Credenciais do canal (channels.credentials jsonb).
 * **IMPORTANTE**: criptografado em nível de aplicação com AES-256 antes de gravar.
 * Nunca exponha esses campos via API pública.
 */
export interface ChannelCredentials {
  // WhatsApp Cloud API
  waba_id?: string;
  phone_number_id?: string;
  access_token?: string;
  app_secret?: string;
  // Instagram / Messenger
  page_id?: string;
  page_access_token?: string;
  // Telegram
  bot_token?: string;
  // Email (SMTP)
  smtp_host?: string;
  smtp_port?: number;
  smtp_user?: string;
  smtp_password?: string;
  // Mercado Livre
  ml_user_id?: string;
  ml_refresh_token?: string;
  // Genérico
  [key: string]: unknown;
}

/** Configuração comportamental do canal (channels.config jsonb) */
export interface ChannelConfig {
  auto_reply?: boolean;
  greeting_message?: string;
  business_hours?: {
    timezone: string;
    /** Por dia da semana (0=domingo); ex: { '1': { open: '09:00', close: '18:00' } } */
    schedule: Record<string, { open: string; close: string } | null>;
  };
  out_of_hours_message?: string;
  webhook_verify_token?: string;
}

/**
 * Canal configurado por organização (uma instância de WhatsApp, IG, etc).
 * Tabela: active.channels
 */
export interface Channel {
  id: UUID;
  org_id: UUID;
  channel_type: ChannelType;
  /** Nome amigável (ex: "WhatsApp Principal") */
  name: string;
  credentials: ChannelCredentials;
  webhook_url: string | null;
  webhook_secret: string | null;
  /** Para WhatsApp */
  phone_number: string | null;
  /** ID do canal no provedor (WABA ID, IG account ID, etc) */
  external_id: string | null;
  status: ChannelStatus;
  error_message: string | null;
  last_webhook_at: ISODateString | null;
  config: ChannelConfig;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Log de eventos de webhook recebidos (para debug e replay).
 * Tabela: active.channel_webhooks
 */
export interface ChannelWebhookEvent {
  id: UUID;
  org_id: UUID;
  channel_id: UUID;
  event_type: string | null;
  payload: Json;
  processed: boolean;
  error: string | null;
  created_at: ISODateString;
}

// ──────────────────────────────────────────────────────────────
// ChannelProvider — interface comum a TODA implementação de canal
// ──────────────────────────────────────────────────────────────

export interface SendMessageInput {
  channel_id: UUID;
  /** ID externo do destinatário (wa_id, psid, etc) */
  to: string;
  content_type: MessageContentType;
  content: Json;
  /** Pra threading: ID externo da mensagem citada */
  reply_to_channel_message_id?: string;
}

export interface SendMessageResult {
  /** ID retornado pelo provedor (wamid, mid, etc) */
  channel_message_id: string;
  status: MessageDeliveryStatus;
  /** Custo em USD se o canal cobrar por mensagem */
  cost_usd?: number;
}

export interface SendMediaInput extends Omit<SendMessageInput, 'content'> {
  /** URL pública ou bucket-signed da mídia */
  media_url: string;
  caption?: string;
  /** mime/type, ex: 'image/jpeg' */
  mime_type?: string;
  filename?: string;
}

export interface WebhookEvent {
  /** Tipo discriminador do evento */
  type:
    | 'message.received'
    | 'message.status'
    | 'contact.profile_updated'
    | 'channel.disconnected'
    | 'unknown';
  channel_id: UUID;
  /** Timestamp original do provedor */
  occurred_at: ISODateString;
  /** Payload normalizado (shape varia por type) */
  data: Json;
}

export interface ChannelContactProfile {
  external_id: string;
  name?: string;
  avatar_url?: string;
  /** Campos extra específicos do canal */
  extra?: Record<string, unknown>;
}

export interface ValidationResult {
  valid: boolean;
  /** Mensagem de erro se valid=false */
  error?: string;
  /** Detalhes específicos retornados pelo provedor */
  details?: Record<string, unknown>;
}

/**
 * Contrato comum a todo provedor de canal (WhatsApp, IG, Telegram, etc).
 * Cada implementação concreta vive em apps/api/src/channels/<provider>/.
 */
export interface ChannelProvider {
  /** Tipo do canal que esta implementação atende */
  readonly channel_type: ChannelType;

  /** Envia uma mensagem (texto/template/etc) pelo canal */
  sendMessage(input: SendMessageInput): Promise<SendMessageResult>;

  /** Normaliza o payload bruto do webhook em uma lista de eventos */
  receiveWebhook(payload: unknown, signature?: string): Promise<WebhookEvent[]>;

  /** Consulta status de entrega de uma mensagem por seu ID externo */
  getMessageStatus(channel_message_id: string): Promise<MessageDeliveryStatus>;

  /** Envia mídia (imagem/áudio/vídeo/documento) — wrapper sobre sendMessage com upload se necessário */
  sendMedia(input: SendMediaInput): Promise<SendMessageResult>;

  /** Verifica se as credenciais estão válidas (typicamente via me/health endpoint) */
  validateCredentials(credentials: ChannelCredentials): Promise<ValidationResult>;

  /** Busca o perfil do contato no canal (nome, avatar) por ID externo */
  getContactProfile(external_id: string): Promise<ChannelContactProfile | null>;
}
