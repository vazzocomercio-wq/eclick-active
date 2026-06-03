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
  /** de onde veio: hashtag (monitor) | profile (perfil curado) | trend | ad. */
  origin?: TrendItemOrigin | null;
  /** liga ao perfil de referência quando origin='profile'. */
  profile_id?: string | null;
  collected_at: string;
  created_at: string;
  updated_at: string;
}

export type TrendItemOrigin = 'hashtag' | 'profile' | 'trend' | 'ad';

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
  profiles?: number;
  active_profiles?: number;
  patterns?: number;
}

// ─── Pilar 1: Perfis de referência (Inteligência Global) ──────────
// Redes que suportam mineração POR PERFIL hoje. IG + TikTok agora; X/
// YouTube entram só adicionando um conector (registry) — sem tocar no motor.
export type ProfileNetwork = 'instagram' | 'tiktok' | 'youtube' | 'x';

export interface TrendProfile {
  id: string;
  org_id: string;
  brand_id: string | null;
  network: ProfileNetwork;
  handle: string;
  display_name: string | null;
  url: string | null;
  country: string | null;
  category: string | null;
  followers: number | null;
  is_active: boolean;
  notes: string | null;
  last_collected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateProfileDto {
  network: ProfileNetwork;
  handle?: string;
  url?: string;
  display_name?: string;
  country?: string;
  category?: string;
  followers?: number;
  brand_id?: string | null;
}

/** Importação em lote: cola uma lista de URLs/handles (a "Google Sheets" do método). */
export interface BulkImportProfilesDto {
  /** linhas livres: URLs (instagram.com/x, tiktok.com/@x) ou "@handle". */
  raw: string;
  /** rede default p/ entradas que não dão pra inferir pela URL. */
  network?: ProfileNetwork;
  category?: string;
  country?: string;
  brand_id?: string | null;
}

export interface UpdateProfileDto {
  display_name?: string;
  country?: string;
  category?: string;
  followers?: number;
  is_active?: boolean;
  notes?: string;
}

export interface ProfileFilters {
  network?: ProfileNetwork;
  category?: string;
  is_active?: boolean;
}

// ─── Pilar 2: Padrões vencedores (Engenharia Reversa) ─────────────
export interface TrendPattern {
  id: string;
  org_id: string;
  brand_id: string | null;
  category: string | null;
  network: string | null;
  source_item_ids: string[];
  hook: string | null;
  hook_type: string | null;
  format: string | null;
  structure: string | null;
  cta: string | null;
  sound: string | null;
  scenario: string | null;
  why_it_works: string | null;
  example_caption: string | null;
  score: number;
  is_active: boolean;
  cost_usd: number;
  created_at: string;
  updated_at: string;
}

export interface AnalyzePatternsDto {
  category?: string;
  network?: TrendNetwork;
  /** quantos itens vencedores analisar (default 15). */
  limit?: number;
  brand_id?: string | null;
}

// ─── Registry de mineração por perfil (platform-agnostic) ─────────
// Cada rede = 1 conector que implementa esta interface. Adicionar X =
// criar a classe + registrar no ProfileMiningService. ZERO no motor.
export interface ProfileMiningOptions {
  /** só posts dos últimos N dias (Aula 29 usa 7 — conteúdo recente vende). */
  newerThanDays: number;
  /** quantos posts puxar por perfil. */
  resultsPerProfile: number;
}

export interface ProfileMiningConnector {
  readonly network: ProfileNetwork;
  isConfigured(): boolean;
  collectProfiles(
    profiles: TrendProfile[],
    opts: ProfileMiningOptions,
  ): Promise<NewTrendItem[]>;
}
