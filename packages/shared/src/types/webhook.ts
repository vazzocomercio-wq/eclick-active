import type { ISODateString, Json, UUID } from './common';

/**
 * Eventos disponíveis para webhooks de saída. Strings exatas — frontend
 * agrupa por entidade na UI multi-select.
 */
export type WebhookEventType =
  | 'contact.created'
  | 'contact.updated'
  | 'contact.deleted'
  | 'deal.created'
  | 'deal.updated'
  | 'deal.stage_changed'
  | 'deal.won'
  | 'deal.lost'
  | 'conversation.created'
  | 'conversation.message_received'
  | 'conversation.message_sent'
  | 'conversation.resolved'
  | 'task.created'
  | 'task.completed'
  | 'task.overdue'
  | 'automation.executed'
  | 'ai.score_calculated'
  | 'ai.suggestion_generated';

/**
 * Endpoint cadastrado pelo agente — URL externa que recebe POSTs.
 * Tabela: active.webhook_endpoints
 */
export interface WebhookEndpoint {
  id: UUID;
  org_id: UUID;
  name: string;
  url: string;
  events: WebhookEventType[];
  /** Secret pra HMAC SHA-256 (header X-Webhook-Signature). Opcional. */
  secret: string | null;
  is_active: boolean;
  failure_count: number;
  last_success_at: ISODateString | null;
  last_failure_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

export type WebhookDeliveryStatus = 'pending' | 'success' | 'failed';

/**
 * Histórico de cada tentativa de POST. Tabela: active.webhook_deliveries
 */
export interface WebhookDelivery {
  id: UUID;
  endpoint_id: UUID;
  org_id: UUID;
  event_type: WebhookEventType;
  payload: Json;
  response_status: number | null;
  response_body: string | null;
  response_time_ms: number | null;
  attempt: number;
  status: WebhookDeliveryStatus;
  error: string | null;
  created_at: ISODateString;
}

export const WEBHOOK_EVENT_TYPES: WebhookEventType[] = [
  'contact.created',
  'contact.updated',
  'contact.deleted',
  'deal.created',
  'deal.updated',
  'deal.stage_changed',
  'deal.won',
  'deal.lost',
  'conversation.created',
  'conversation.message_received',
  'conversation.message_sent',
  'conversation.resolved',
  'task.created',
  'task.completed',
  'task.overdue',
  'automation.executed',
  'ai.score_calculated',
  'ai.suggestion_generated',
];
