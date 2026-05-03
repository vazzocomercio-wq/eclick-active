import type { UUID, ISODateString } from './common';
import type { Contact } from './contact';
import type {
  ChannelType,
  ConversationStatus,
  ConversationPriority,
  AISentiment,
  ContactTemperature,
} from '../enums';

/**
 * Thread de conversa omnichannel com um contato.
 * Tabela: active.conversations
 */
export interface Conversation {
  id: UUID;
  org_id: UUID;
  contact_id: UUID;
  channel_id: UUID | null;
  channel_type: ChannelType;
  // Status & prioridade
  status: ConversationStatus;
  priority: ConversationPriority;
  // Atribuição
  /** user_id do agente atribuído (null = não atribuído) */
  assigned_to: UUID | null;
  team_id: UUID | null;
  // Contadores
  unread_count: number;
  message_count: number;
  // Campos gerados por IA (atualizados assíncrona após mensagens)
  ai_summary: string | null;
  ai_sentiment: AISentiment | null;
  /** Intenção detectada: budget, question, complaint, negotiation, support, etc. */
  ai_intent: string | null;
  ai_temperature: ContactTemperature | null;
  ai_next_action: string | null;
  // Metadata
  tags: string[];
  custom_fields: Record<string, unknown>;
  /** jsonb arbitrário — usa pra transfer_briefing, pending_transfer, etc. (Bloco G) */
  metadata: Record<string, unknown>;
  snoozed_until: ISODateString | null;
  /** Setado uma única vez na primeira resposta de agente (outbound + sender_type=agent) */
  first_response_at: ISODateString | null;
  resolved_at: ISODateString | null;
  last_message_at: ISODateString | null;
  /** Marcação rápida de favorito por agente (Melhoria 9). */
  is_starred: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Linha da view `active.v_inbox` — usada pra renderizar o inbox.
 * Denormaliza dados de contact, channel e agente atribuído.
 */
export interface InboxItem {
  // Conversation core
  id: UUID;
  org_id: UUID;
  status: ConversationStatus;
  priority: ConversationPriority;
  assigned_to: UUID | null;
  unread_count: number;
  ai_summary: string | null;
  ai_sentiment: AISentiment | null;
  ai_intent: string | null;
  ai_temperature: ContactTemperature | null;
  ai_next_action: string | null;
  tags: string[];
  last_message_at: ISODateString | null;
  first_response_at: ISODateString | null;
  is_starred: boolean;
  created_at: ISODateString;
  channel_type: ChannelType;
  // Contact (join)
  contact_id: UUID;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  contact_avatar: string | null;
  contact_temperature: ContactTemperature | null;
  contact_score: number;
  // Channel (join)
  channel_name: string | null;
  // Agent (join)
  agent_name: string | null;
  agent_avatar: string | null;
}

/**
 * Conversa com o contato vinculado em uma só resposta — shape devolvido por
 * GET /conversations/:id. Subset de campos do contato pra evitar payload grande.
 */
export interface ConversationDetail extends Conversation {
  contact: Pick<
    Contact,
    | 'id'
    | 'name'
    | 'phone'
    | 'email'
    | 'avatar_url'
    | 'temperature'
    | 'score'
    | 'tags'
    | 'whatsapp_verified'
    | 'whatsapp_jid'
    | 'whatsapp_profile_name'
    | 'whatsapp_profile_pic_url'
  > | null;
}
