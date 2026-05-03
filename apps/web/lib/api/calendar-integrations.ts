import type { CalendarIntegrationPublic } from '@eclick-active/shared';
import { api } from './client';

export const calendarIntegrationsApi = {
  list(agentId?: string, signal?: AbortSignal): Promise<CalendarIntegrationPublic[]> {
    return api.get<CalendarIntegrationPublic[]>('/calendar/integrations', {
      query: agentId ? { agent_id: agentId } : {},
      signal,
    });
  },
  getGoogleAuthUrl(agentId?: string): Promise<{ url: string }> {
    return api.get<{ url: string }>('/calendar/google/auth', {
      query: agentId ? { agent_id: agentId } : {},
    });
  },
  getCalendlyAuthUrl(agentId?: string): Promise<{ url: string }> {
    return api.get<{ url: string }>('/calendar/calendly/auth', {
      query: agentId ? { agent_id: agentId } : {},
    });
  },
  getCalendlyEventTypes(integrationId: string, signal?: AbortSignal) {
    return api.get<
      Array<{ uri: string; name: string; scheduling_url: string; duration: number; active: boolean }>
    >(`/calendar/calendly/event-types/${integrationId}`, { signal });
  },
  updateSettings(
    id: string,
    patch: {
      sync_enabled?: boolean;
      consider_personal_events?: boolean;
      bidirectional_sync?: boolean;
      auto_create_deal?: boolean;
    },
  ): Promise<CalendarIntegrationPublic> {
    return api.patch<CalendarIntegrationPublic>(`/calendar/integrations/${id}`, patch);
  },
  disconnect(id: string): Promise<void> {
    return api.delete<void>(`/calendar/integrations/${id}`);
  },
  syncNow(id: string): Promise<{ ok: true; synced_at: string }> {
    return api.post<{ ok: true; synced_at: string }>(`/calendar/integrations/${id}/sync`);
  },
};
