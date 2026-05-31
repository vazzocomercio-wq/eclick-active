import { api } from './client';

// ────────────────────────────────────────────
// Tipos — espelham apps/api/.../ads-agent
// ────────────────────────────────────────────

export type Platform =
  | 'meta' | 'tiktok' | 'mercadolivre' | 'shopee' | 'x' | 'linkedin' | 'pinterest' | 'google';

export type AccountStatus = 'active' | 'paused' | 'error' | 'disconnected';
export type SpendTier = 'low' | 'standard' | 'high';
export type DecisionMode = 'copilot' | 'auto';
export type DecisionType =
  | 'scale_budget' | 'reduce_budget' | 'pause' | 'activate' | 'adjust_bid' | 'reallocate';
export type DecisionStatus =
  | 'pending' | 'approved' | 'rejected' | 'applied' | 'failed' | 'rolled_back';

export interface AccountOverview {
  id: string;
  name: string | null;
  platform: Platform;
  status: AccountStatus;
  spend_tier: SpendTier;
  decision_mode: DecisionMode;
  last_polled_at: string | null;
  campaigns: number;
  active_campaigns: number;
  spend_cents: number;
  results: number;
  revenue_cents: number;
  cost_per_result_cents: number | null;
  roas: number | null;
}

export interface AdsOverview {
  window_days: number;
  totals: {
    accounts: number;
    active_accounts: number;
    campaigns: number;
    active_campaigns: number;
    spend_cents: number;
    results: number;
    revenue_cents: number;
    cost_per_result_cents: number | null;
    roas: number | null;
    pending_decisions: number;
  };
  accounts: AccountOverview[];
}

export interface AdsDecision {
  id: string;
  entity_id: string;
  account_id: string;
  type: DecisionType;
  rationale: string;
  signals: Record<string, unknown>;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
  confidence: number;
  mode: string;
  status: DecisionStatus;
  created_at: string;
  entity_name?: string | null;
  entity_external_id?: string | null;
  outcome_verdict?: 'positive' | 'negative' | 'neutral' | null;
}

export interface CampaignDossier {
  external_id: string;
  name: string | null;
  objective: string | null;
  status: string;
  budget_brl: number | null;
  budget_type: string | null;
  data_days: number;
  window: {
    spend_brl: number; conversions: number; revenue_brl: number;
    impressions: number; clicks: number;
  };
  averages: {
    daily_spend_brl: number; cpa_brl: number | null; roas: number | null;
    ctr_pct: number | null; cpm_brl: number | null; avg_frequency: number | null;
  };
  trend: {
    roas_recent: number | null; roas_prior: number | null; roas_change_pct: number | null;
    cpa_recent_brl: number | null; cpa_prior_brl: number | null;
    label: 'improving' | 'declining' | 'stable' | 'insufficient';
  };
}
export interface AccountCampaigns {
  account_id: string;
  platform: string;
  currency: string;
  entities: CampaignDossier[];
}

export interface EnrollableIntegration {
  id: string;
  platform: string;
  ad_account_id: string;
  account_name: string | null;
  status: string;
}

export interface IngestResult {
  account_id: string; platform: string;
  entities_upserted: number; insights_upserted: number; insights_orphaned: number; duration_ms: number;
}
export interface AnalyzeResult {
  account_id: string; proposed: number; persisted: number; skipped: number; reason?: string;
}
export interface ApplyResult { id: string; status: string; message: string }

export const adsCentralApi = {
  overview: () => api.get<AdsOverview>('/ads-agent/overview'),
  campaigns: (accountId: string) =>
    api.get<AccountCampaigns>(`/ads-agent/accounts/${accountId}/campaigns`),

  // contas
  integrations: () => api.get<EnrollableIntegration[]>('/ad-integrations'),
  enroll: (integration_id: string) =>
    api.post<AccountOverview>('/ads-agent/accounts/enroll', { integration_id }),
  setAccountStatus: (id: string, status: 'active' | 'paused') =>
    api.patch<AccountOverview>(`/ads-agent/accounts/${id}/status`, { status }),
  setMode: (id: string, mode: DecisionMode) =>
    api.patch<AccountOverview>(`/ads-agent/accounts/${id}/mode`, { mode }),
  sync: (id: string) => api.post<IngestResult>(`/ads-agent/accounts/${id}/sync`),
  analyze: (id: string) => api.post<AnalyzeResult>(`/ads-agent/accounts/${id}/analyze`),

  // decisões
  decisions: (status: DecisionStatus = 'pending') =>
    api.get<AdsDecision[]>('/ads-agent/decisions', { query: { status } }),
  approve: (id: string) => api.post<ApplyResult>(`/ads-agent/decisions/${id}/approve`),
  reject: (id: string) => api.post<AdsDecision>(`/ads-agent/decisions/${id}/reject`),
  rollback: (id: string) => api.post<ApplyResult>(`/ads-agent/decisions/${id}/rollback`),
  editBudget: (id: string, after_budget_brl: number) =>
    api.patch<AdsDecision>(`/ads-agent/decisions/${id}`, { after_budget_brl }),
};
