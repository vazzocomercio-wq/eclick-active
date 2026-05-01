import type { Json, UUID, ISODateString } from './common';
import type {
  MessageDirection,
  MessageSenderType,
  MessageContentType,
  MessageDeliveryStatus,
  MessageTemplateCategory,
  MessageTemplateStatus,
  ChannelType,
  AISentiment,
} from '../enums';

// ──────────────────────────────────────────────────────────────
// Discriminated union para messages.content (jsonb)
// ──────────────────────────────────────────────────────────────

export interface MessageContentText {
  body: string;
}

export interface MessageContentImage {
  url: string;
  caption?: string;
  mime_type?: string;
}

export interface MessageContentAudio {
  url: string;
  duration_seconds?: number;
  mime_type?: string;
}

export interface MessageContentVideo {
  url: string;
  caption?: string;
  duration_seconds?: number;
  mime_type?: string;
}

export interface MessageContentDocument {
  url: string;
  filename: string;
  mime_type?: string;
  size_bytes?: number;
}

export interface MessageContentTemplate {
  template_name: string;
  language?: string;
  parameters?: Array<string | number>;
}

export interface MessageContentLocation {
  latitude: number;
  longitude: number;
  name?: string;
  address?: string;
}

export interface MessageContentSticker {
  url: string;
  pack_id?: string;
}

export interface MessageContentReaction {
  emoji: string;
  target_message_id: UUID;
}

export interface MessageContentInteractive {
  type: 'button' | 'list' | 'product' | 'cta';
  body?: string;
  buttons?: Array<{ id: string; title: string }>;
  list?: { sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }> };
}

export interface MessageContentSystem {
  event: string;
  details?: Json;
}

/** Conteúdo da mensagem — shape varia conforme `content_type` */
export type MessageContent =
  | ({ kind: 'text' } & MessageContentText)
  | ({ kind: 'image' } & MessageContentImage)
  | ({ kind: 'audio' } & MessageContentAudio)
  | ({ kind: 'video' } & MessageContentVideo)
  | ({ kind: 'document' } & MessageContentDocument)
  | ({ kind: 'template' } & MessageContentTemplate)
  | ({ kind: 'location' } & MessageContentLocation)
  | ({ kind: 'sticker' } & MessageContentSticker)
  | ({ kind: 'reaction' } & MessageContentReaction)
  | ({ kind: 'interactive' } & MessageContentInteractive)
  | ({ kind: 'system' } & MessageContentSystem);

// ──────────────────────────────────────────────────────────────
// Message
// ──────────────────────────────────────────────────────────────

/**
 * Mensagem individual (particionada por mês via created_at).
 * Tabela: active.messages
 */
export interface Message {
  id: UUID;
  conversation_id: UUID;
  org_id: UUID;
  // Direção e remetente
  direction: MessageDirection;
  sender_type: MessageSenderType;
  /** user_id do agente, ou null se sender_type = contact/bot */
  sender_id: UUID | null;
  // Conteúdo (formato flexível por content_type)
  content_type: MessageContentType;
  content: Json;
  /** Texto extraído pra full-text search (gerado a partir de content) */
  plain_text: string | null;
  // Mídia
  media_url: string | null;
  media_mime_type: string | null;
  media_size_bytes: number | null;
  /** ID original da mensagem no canal (WhatsApp, IG, etc.) */
  channel_message_id: string | null;
  // Status de entrega
  status: MessageDeliveryStatus;
  error_code: string | null;
  error_message: string | null;
  // Análise de IA (preenchida assíncrona)
  ai_intent: string | null;
  ai_sentiment: AISentiment | null;
  // Metadata
  metadata: Json;
  /** Nota interna do agente — não é entregue ao contato */
  is_internal_note: boolean;
  created_at: ISODateString;
}

// ──────────────────────────────────────────────────────────────
// Message templates (HSM WhatsApp, quick replies IG, etc.)
// ──────────────────────────────────────────────────────────────

export interface MessageTemplateContent {
  header?: { type: 'text' | 'image' | 'video' | 'document'; content?: string; url?: string };
  body: string;
  footer?: string;
  buttons?: Array<{ type: 'quick_reply' | 'url' | 'phone'; text: string; value?: string }>;
}

/**
 * Template de mensagem aprovado pelo provedor (ex: WhatsApp HSM).
 * Tabela: active.message_templates
 */
export interface MessageTemplate {
  id: UUID;
  org_id: UUID;
  channel_type: ChannelType;
  name: string;
  category: MessageTemplateCategory | null;
  /** BCP 47 (ex: 'pt_BR', 'en_US') */
  language: string;
  content: MessageTemplateContent;
  /** Variáveis declaradas no body — ex: ['{{1}}', '{{2}}'] */
  variables: string[];
  status: MessageTemplateStatus;
  /** ID do template no provedor (ex: WhatsApp template ID) */
  external_id: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
