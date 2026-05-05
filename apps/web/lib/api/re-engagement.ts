import { api } from './client';

export interface ReEngagementSettings {
  enabled: boolean;
  days_threshold: number;
  max_retries: number;
  only_with_open_deal: boolean;
  min_advance_days_between: number;
}

export interface ReEngagementRun {
  id: string;
  org_id: string;
  conversation_id: string;
  contact_id: string;
  message_text: string;
  message_id: string | null;
  status: 'ok' | 'failed' | 'skipped';
  replied_at: string | null;
  error_message: string | null;
  days_since_last_activity: number;
  retry_number: number;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface EligibleConversation {
  conversation_id: string;
  contact_id: string;
  contact_name: string | null;
  channel_id: string | null;
  last_activity_at: string;
  days_since_last_activity: number;
  retry_number: number;
  last_inbound_text: string | null;
  deal_tags: string[];
}

export const reEngagementApi = {
  getSettings(signal?: AbortSignal): Promise<ReEngagementSettings> {
    return api.get<ReEngagementSettings>('/re-engagement/settings', { signal });
  },
  updateSettings(input: Partial<ReEngagementSettings>): Promise<ReEngagementSettings> {
    return api.patch<ReEngagementSettings>('/re-engagement/settings', input);
  },
  listRuns(signal?: AbortSignal): Promise<ReEngagementRun[]> {
    return api.get<ReEngagementRun[]>('/re-engagement/runs', { signal });
  },
  listEligible(signal?: AbortSignal): Promise<EligibleConversation[]> {
    return api.get<EligibleConversation[]>('/re-engagement/eligible', { signal });
  },
  runNow(): Promise<{ processed: number; sent: number; skipped: number }> {
    return api.post<{ processed: number; sent: number; skipped: number }>(
      '/re-engagement/run-now',
    );
  },
};
