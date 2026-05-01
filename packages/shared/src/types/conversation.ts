import type { UUID, ISODateString } from './common';
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
  snoozed_until: ISODateString | null;
  /** Setado uma única vez na primeira resposta de agente (outbound + sender_type=agent) */
  first_response_at: ISODateString | null;
  resolved_at: ISODateString | null;
  last_message_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
