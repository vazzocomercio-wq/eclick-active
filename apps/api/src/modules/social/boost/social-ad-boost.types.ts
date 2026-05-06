/**
 * Tipos do subsistema de boost (promover post como ad).
 */

export type BoostPlatform = 'meta' | 'google' | 'tiktok_ads';

export type BoostObjective =
  | 'OUTCOME_AWARENESS'
  | 'OUTCOME_TRAFFIC'
  | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS'
  | 'OUTCOME_APP_PROMOTION'
  | 'OUTCOME_SALES';

export type BoostStatus =
  | 'draft'
  | 'reviewed'
  | 'sent_to_platform'
  | 'live'
  | 'paused'
  | 'completed'
  | 'cancelled';

export interface SocialAdBoostDraft {
  id: string;
  org_id: string;
  content_id: string;
  brand_id: string | null;
  signal_id: string | null;
  platform: BoostPlatform;
  objective: BoostObjective;
  daily_budget_cents: number;
  duration_days: number;
  target_locations: string[];
  target_age_min: number | null;
  target_age_max: number | null;
  target_genders: string[];
  target_interests: string[];
  target_audience_summary: string | null;
  ai_budget_rationale: string | null;
  ai_audience_rationale: string | null;
  ai_copy_suggestions: Array<{ caption: string; reason: string }>;
  status: BoostStatus;
  external_campaign_id: string | null;
  external_account_id: string | null;
  meta_deep_link: string | null;
  reviewed_at: string | null;
  sent_to_platform_at: string | null;
  reviewed_by: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BoostSuggestion {
  /** Budget diário sugerido em centavos. */
  daily_budget_cents: number;
  /** Justificativa do budget. */
  budget_rationale: string;
  /** Duração sugerida em dias. */
  duration_days: number;
  /** Objetivo recomendado pelo pilar do post. */
  objective: BoostObjective;
  /** Audiência sugerida em formato livre (ex: "Mulheres 25-45, interesses em decoração"). */
  audience_summary: string;
  /** Faixa etária. */
  age_min: number;
  age_max: number;
  /** Gêneros. */
  genders: string[];
  /** Interesses (Meta Ads taxonomy). */
  interests: string[];
  /** Localizações. */
  locations: string[];
  /** 2-3 sugestões alternativas de caption otimizadas pra ad. */
  copy_suggestions: Array<{ caption: string; reason: string }>;
}
