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

export type AdCreativeFormat = 'image' | 'carousel' | 'video' | 'reels';
export type AdCreativeSource = 'ai' | 'manual' | 'content';

export interface AdCard {
  image_url?: string;
  image_hash?: string;
  headline?: string;
  description?: string;
  link?: string;
}

export interface AdVideo {
  url?: string;
  video_id?: string;
  thumbnail_url?: string;
  duration_sec?: number;
  width?: number;
  height?: number;
}

export interface ComplianceIssue {
  code: string;
  severity: 'hard' | 'soft';
  message: string;
  field?: string;
}
export interface ComplianceResult {
  ok: boolean;
  hard: ComplianceIssue[];
  soft: ComplianceIssue[];
}

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
  creative_format: AdCreativeFormat;
  creative_source: AdCreativeSource;
  content_id: string | null;
  object_story_id: string | null;
  cards: AdCard[];
  video: AdVideo | null;
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

export interface AdAudience {
  id: string;
  integration_id: string;
  external_audience_id: string | null;
  name: string;
  type: 'custom' | 'lookalike';
  source: string;
  lookalike_country: string | null;
  lookalike_ratio: number | null;
  matched_count: number | null;
  approximate_count: number | null;
  status: 'pending' | 'ready' | 'error' | 'archived';
  last_error: string | null;
  created_at: string;
}

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

  /** Cria anúncio a partir de um conteúdo do Studio (post/carrossel/reel). */
  fromContent: (input: {
    integration_id: string;
    content_id: string;
    page_id?: string;
    instagram_actor_id?: string;
    objective?: AdObjective;
    destination_url?: string;
    budget_daily_cents?: number;
  }) => api.post<AdComposition>('/ad-compositions/from-content', input),

  /** Roda o validador anti-reprovação sem publicar. */
  validate: (id: string) => api.post<ComplianceResult>(`/ad-compositions/${id}/validate`),

  update: (id: string, patch: UpdateInput) =>
    api.patch<AdComposition>(`/ad-compositions/${id}`, patch),

  archive: (id: string) => api.delete<void>(`/ad-compositions/${id}`),

  publish: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/publish`),
  pause: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/pause`),
  resume: (id: string) => api.post<AdComposition>(`/ad-compositions/${id}/resume`),

  // Públicos (Custom Audience do CRM + Lookalike)
  audiences: {
    list: () => api.get<AdAudience[]>('/ad-audiences'),
    fromCrm: (body: { integration_id: string; name?: string }) =>
      api.post<AdAudience>('/ad-audiences/from-crm', body),
    lookalike: (body: { integration_id: string; source_audience_id: string; name?: string; country?: string; ratio?: number }) =>
      api.post<AdAudience>('/ad-audiences/lookalike', body),
    archive: (id: string) => api.delete<void>(`/ad-audiences/${id}`),
  },
};
