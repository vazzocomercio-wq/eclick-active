/**
 * Radar de Conteúdo — tipos.
 * Espelham as tabelas active.trend_* (migration 082).
 */

export type TrendNetwork =
  | 'youtube'
  | 'meta_ads'
  | 'tiktok'
  | 'google_trends'
  | 'instagram';

export type TrendItemKind =
  | 'video'
  | 'short'
  | 'ad_creative'
  | 'sound'
  | 'hashtag'
  | 'search_term'
  | 'post';

export type TrendSignalType =
  | 'format_rising'
  | 'topic_rising'
  | 'sound_trending'
  | 'hashtag_trending'
  | 'competitor_active'
  | 'search_spike';

export type TrendBriefStatus = 'draft' | 'used' | 'dismissed';

export interface TrendCompetitor {
  name: string;
  handle?: string | null;
  page_id?: string | null;
  url?: string | null;
}

export interface TrendMonitor {
  id: string;
  org_id: string;
  brand_id: string | null;
  network: TrendNetwork;
  category: string;
  keywords: string[];
  competitors: TrendCompetitor[];
  region: string;
  language: string;
  is_active: boolean;
  config: Record<string, unknown>;
  last_collected_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Métricas por item — shape genérico; cada fonte preenche o que tem. */
export interface TrendItemMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  duration_sec?: number;
  growth_pct?: number;
  engagement_rate?: number;
  uses?: number; // sons/hashtags: nº de usos
  [k: string]: number | undefined;
}

export interface TrendItem {
  id: string;
  org_id: string;
  monitor_id: string | null;
  source: TrendNetwork;
  external_id: string;
  kind: TrendItemKind;
  category: string | null;
  title: string | null;
  description: string | null;
  url: string | null;
  thumbnail_url: string | null;
  author_name: string | null;
  author_handle: string | null;
  media_type: string | null;
  lang: string | null;
  region: string | null;
  published_at: string | null;
  metrics: TrendItemMetrics;
  score: number;
  collected_at: string;
  created_at: string;
  updated_at: string;
}

/** Item pronto pra upsert (sem campos gerados pelo banco/coletor). */
export type NewTrendItem = Omit<
  TrendItem,
  'id' | 'org_id' | 'collected_at' | 'created_at' | 'updated_at'
>;

export interface TrendSignal {
  id: string;
  org_id: string;
  monitor_id: string | null;
  source: TrendNetwork;
  category: string | null;
  signal_type: TrendSignalType;
  title: string;
  summary: string | null;
  score: number;
  evidence_item_ids: string[];
  payload: Record<string, unknown>;
  window_start: string | null;
  window_end: string | null;
  detected_at: string;
  dismissed_at: string | null;
  created_at: string;
}

export interface TrendBrief {
  id: string;
  org_id: string;
  signal_id: string | null;
  category: string | null;
  title: string;
  format: string;
  hook: string | null;
  script: string | null;
  visual_style: string | null;
  suggested_products: unknown[];
  hashtags: string[];
  cta: string | null;
  rationale: string | null;
  status: TrendBriefStatus;
  cost_usd: number;
  created_at: string;
  updated_at: string;
}

// ─── DTOs ─────────────────────────────────────────

export interface CreateMonitorDto {
  network: TrendNetwork;
  category: string;
  keywords?: string[];
  competitors?: TrendCompetitor[];
  region?: string;
  language?: string;
  brand_id?: string | null;
  config?: Record<string, unknown>;
}

export interface UpdateMonitorDto {
  category?: string;
  keywords?: string[];
  competitors?: TrendCompetitor[];
  region?: string;
  language?: string;
  is_active?: boolean;
  config?: Record<string, unknown>;
}

export interface TrendItemFilters {
  source?: TrendNetwork;
  category?: string;
  kind?: TrendItemKind;
  monitor_id?: string;
  limit?: number;
}

// ─── Overview (estado do Radar) ───────────────────

/** Catálogo de fontes + o estágio em que cada conector entra. */
export interface TrendSourceStatus {
  source: TrendNetwork;
  label: string;
  /** 'live' = coletando; 'planned' = conector ainda não construído/conectado. */
  status: 'live' | 'planned';
  phase: string; // ex "TR-1"
  note: string;
  items: number;
  last_collected_at: string | null;
}

export interface TrendsOverview {
  monitors: number;
  active_monitors: number;
  items: number;
  signals: number;
  briefs: number;
  categories: string[];
  by_source: TrendSourceStatus[];
  generated_at: string;
}
