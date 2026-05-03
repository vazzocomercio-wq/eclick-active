import type { ISODateString, UUID } from './common';

export type CalendarProvider = 'google' | 'outlook' | 'calendly';
export type CalendarIntegrationStatus =
  | 'active'
  | 'expired'
  | 'revoked'
  | 'error'
  | 'pending';

/**
 * Integração de calendário por agente. Os tokens são criptografados
 * AES-256-GCM via ENCRYPTION_KEY antes de gravar no banco — nunca
 * expostos no payload da API (a service só retorna metadados +
 * status; tokens só são lidos internamente quando vai chamar a API
 * externa).
 *
 * Tabela: active.calendar_integrations
 */
export interface CalendarIntegration {
  id: UUID;
  org_id: UUID;
  agent_id: UUID;
  provider: CalendarProvider;
  /** Sempre null no payload exposto pela API. */
  access_token: string | null;
  /** Sempre null no payload exposto pela API. */
  refresh_token: string | null;
  token_expires_at: ISODateString | null;
  calendar_id: string | null;
  calendar_name: string | null;
  sync_enabled: boolean;
  consider_personal_events: boolean;
  bidirectional_sync: boolean;
  auto_create_deal: boolean;
  last_synced_at: ISODateString | null;
  webhook_channel_id: string | null;
  webhook_resource_id: string | null;
  webhook_expiration: ISODateString | null;
  status: CalendarIntegrationStatus;
  last_error: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/** Shape exposto na API pra UI — sem tokens sensíveis. */
export type CalendarIntegrationPublic = Omit<
  CalendarIntegration,
  'access_token' | 'refresh_token'
>;
