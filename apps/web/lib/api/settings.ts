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

/**
 * Setting do AI Concierge (em organizations.settings.ai_concierge).
 *
 * Quando enabled, em cada msg inbound a IA atua como recepcionista:
 *   1. Cumprimenta o cliente com pergunta de sondagem (se auto_reply)
 *   2. Aguarda resposta
 *   3. Classifica a resposta e DECIDE qual pipeline+stage encaixar o lead
 *      lendo as descrições dos pipelines da org + business_context.
 */
export interface AiConciergeSetting {
  enabled: boolean;
  /** Se false, concierge não envia mensagem (modo silent até habilitar). */
  auto_reply: boolean;
  /** Envia mensagem de transição ao rotear o lead. Default true. */
  send_bridge_message: boolean;
  /** Texto livre que descreve o negócio (vai pro prompt da IA). */
  business_context: string;
}

export interface UpdateOrgInput {
  name?: string;
  slug?: string;
  /** Mergeado em settings (raso). Use shape conhecido como `auto_create_deal`. */
  settings?: {
    auto_create_deal?: AutoCreateDealSetting;
    ai_concierge?: AiConciergeSetting;
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

export interface AiBudget {
  configured: boolean;
  monthly_budget_usd: number | null;
  alert_threshold_pct: number;
  hard_cap: boolean;
  updated_at: string | null;
}

export interface UpdateAiBudgetInput {
  monthly_budget_usd?: number | null;
  alert_threshold_pct?: number;
  hard_cap?: boolean;
}

export interface AiUsageBreakdownRow {
  key: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  usd: number;
}

export interface AiUsageSummary {
  period_start: string;
  total_calls: number;
  total_input_tokens: number;
  total_output_tokens: number;
  total_usd: number;
  by_feature: AiUsageBreakdownRow[];
  by_model: AiUsageBreakdownRow[];
  budget: AiBudget;
  pct_used: number;
}

export interface AiUsageTimelinePoint {
  date: string;
  calls: number;
  usd: number;
}

export interface AiUsageTimeline {
  days: number;
  series: AiUsageTimelinePoint[];
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
  getAiBudget(signal?: AbortSignal): Promise<AiBudget> {
    return api.get<AiBudget>('/settings/ai-budget', { signal });
  },
  updateAiBudget(input: UpdateAiBudgetInput): Promise<AiBudget> {
    return api.patch<AiBudget>('/settings/ai-budget', input);
  },
  getAiUsageSummary(signal?: AbortSignal): Promise<AiUsageSummary> {
    return api.get<AiUsageSummary>('/settings/ai-usage/summary', { signal });
  },
  getAiUsageTimeline(days = 30, signal?: AbortSignal): Promise<AiUsageTimeline> {
    return api.get<AiUsageTimeline>(`/settings/ai-usage/timeline?days=${days}`, { signal });
  },
};
