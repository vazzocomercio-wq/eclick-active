import type { AIFeatureName, Plan } from '@eclick-active/shared';
import { api } from './client';

export interface OrgSettings {
  id: string;
  name: string;
  slug: string;
  plan: Plan;
  trial_ends_at: string | null;
  max_users: number;
  max_channels: number;
  max_pipelines: number;
  max_automations: number;
  has_copilot: boolean;
  has_audit: boolean;
  has_erp_integration: boolean;
  member_count: number;
  channel_count: number;
  /** Settings livres (jsonb) — auto_create_deal, etc. */
  settings: Record<string, unknown>;
}

export interface AutoCreateDealSetting {
  enabled: boolean;
  pipeline_id?: string | null;
  stage_id?: string | null;
  /** Permite IA escolher o stage. Default: true. */
  ai_position?: boolean;
}

export interface UpdateOrgInput {
  name?: string;
  slug?: string;
  /** Mergeado em settings (raso). Use shape conhecido como `auto_create_deal`. */
  settings?: {
    auto_create_deal?: AutoCreateDealSetting;
    [key: string]: unknown;
  };
}

export interface AiFeature {
  id: string;
  feature_name: AIFeatureName;
  provider: string;
  model: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: string;
}

export interface UpdateAiFeatureInput {
  enabled?: boolean;
  provider?: string;
  model?: string;
  config?: Record<string, unknown>;
}

export const settingsApi = {
  getOrg(signal?: AbortSignal): Promise<OrgSettings> {
    return api.get<OrgSettings>('/settings/org', { signal });
  },
  updateOrg(input: UpdateOrgInput): Promise<OrgSettings> {
    return api.patch<OrgSettings>('/settings/org', input);
  },
  getAi(signal?: AbortSignal): Promise<AiFeature[]> {
    return api.get<AiFeature[]>('/settings/ai', { signal });
  },
  updateAi(featureName: AIFeatureName, input: UpdateAiFeatureInput): Promise<AiFeature> {
    return api.patch<AiFeature>(`/settings/ai/${featureName}`, input);
  },
};
