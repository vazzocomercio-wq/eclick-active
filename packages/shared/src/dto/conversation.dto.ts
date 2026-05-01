import type { UUID } from '../types/common';
import type {
  ChannelType,
  ConversationStatus,
  ConversationPriority,
} from '../enums';

/**
 * Criação manual de conversa (POST /conversations).
 * Conversas tipicamente são criadas automaticamente ao receber webhook;
 * use isso quando o agente inicia outbound (ex: cold outreach).
 */
export interface CreateConversationDto {
  contact_id: UUID;
  channel_id?: UUID;
  channel_type: ChannelType;
  priority?: ConversationPriority;
  assigned_to?: UUID;
  tags?: string[];
}

/** Atualização parcial (PATCH /conversations/:id) */
export interface UpdateConversationDto {
  status?: ConversationStatus;
  priority?: ConversationPriority;
  assigned_to?: UUID | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
}

/** Snooze (POST /conversations/:id/snooze) */
export interface SnoozeConversationDto {
  /** ISO 8601 — quando a conversa volta a aparecer no inbox */
  snoozed_until: string;
}

/** Resolver conversa (POST /conversations/:id/resolve) */
export interface ResolveConversationDto {
  /** Comentário interno de fechamento (opcional) */
  resolution_note?: string;
}

/** Reatribuir (POST /conversations/:id/assign) */
export interface AssignConversationDto {
  /** null = desatribuir */
  assigned_to: UUID | null;
}
