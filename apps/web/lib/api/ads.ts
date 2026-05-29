import { api } from './client';

// ────────────────────────────────────────────
// Tipos (espelham apps/api .../ads/publish/ad-compositions.types.ts)
// ────────────────────────────────────────────

export type AdObjective =
  | 'traffic'
  | 'conversions'
  | 'engagement'
  | 'awareness'
  | 'catalog_sales'
  | 'leads';

export type AdCompositionStatus =
  | 'draft'
  | 'ready'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'paused'
  | 'archived';

export interface AdCopy {
  variant: string;
  headline: string;
  primary_text: string;
  description?: string;
  cta: string;
  angle?: string;
  image_url?: string;
  image_hash?: string;
}

export interface AdComposition {
  id: string;
  org_id: string;
  integration_id: string;
  platform: 'meta';
  ad_account_id: string;
  page_id: string | null;
  instagram_actor_id: string | null;
  product_ref: string | null;
  name: string;
  objective: AdObjective;
  optimization_goal: string | null;
  status: AdCompositionStatus;
  targeting: Record<string, unknown>;
  budget_daily_cents: number;
  budget_total_cents: number | null;
  duration_days: number;
  bid_strategy: string;
  bid_amount_cents: number | null;
  special_ad_categories: string[];
  ad_copies: AdCopy[];
  destination_url: string | null;
  utm_params: Record<string, string>;
  external_campaign_id: string | null;
  external_adset_id: string | null;
  external_ad_ids: string[];
  published_at: string | null;
  last_error: string | null;
  generation_metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MetaPage {
  id: string;
  name: string;
  instagram_actor_id: string | null;
}

/** Integração (conta de anúncios conectada) — subset usado pela UI. */
export interface AdIntegration {
  id: string;
  platform: 'meta' | 'google';
  ad_account_id: string;
  account_name: string | null;
  status: 'active' | 'token_expired' | 'error' | 'disconnected';
}

export interface GenerateInput {
  integration_id: string;
  objective?: AdObjective;
  page_id?: string;
  instagram_actor_id?: string;
  destination_url?: string;
  product: {
    name: string;
    description?: string;
    price_brl?: number;
    category?: string;
    audience?: string;
    image_url?: string;
    product_ref?: string;
  };
}

export type UpdateInput = Partial<{
  name: string;
  objective: AdObjective;
  page_id: string;
  instagram_actor_id: string;
  targeting: Record<string, unknown>;
  budget_daily_cents: number;
  budget_total_cents: number;
  duration_days: number;
  bid_strategy: string;
  bid_amount_cents: number;
  special_ad_categories: string[];
  ad_copies: AdCopy[];
  destination_url: string;
  utm_params: Record<string, string>;
  status: 'draft' | 'ready' | 'archived';
}>;

// ────────────────────────────────────────────
// API
// ────────────────────────────────────────────

export const adsApi = {
  /** Contas de anúncios conectadas (Bloco B). */
  listIntegrations: () => api.get<AdIntegration[]>('/ad-integrations'),

  /** Páginas do Facebook elegíveis pra assinar anúncios de uma conta. */
  listPages: (integrationId: string) =>
    api.get<MetaPage[]>(`/ad-compositions/pages/${integrationId}`),

  list: (status?: string) =>
    api.get<AdComposition[]>('/ad-compositions', { query: { status } }),

  get: (id: string) => api.get<AdComposition>(`/ad-compositions/${id}`),

  generate: (input: GenerateInput) =>
    api.post<AdComposition>('/ad-compositions/generate', input),

  update: (id: string, patch: UpdateInput) =>
    api.patch<AdComposition>(`/ad-compositions/${id}`, patch),

  archive: (id: string) => api.delete<void>(`/ad-compositions/${id}`),

  publish: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/publish`),
  pause: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/pause`),
  resume: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/resume`),
};
