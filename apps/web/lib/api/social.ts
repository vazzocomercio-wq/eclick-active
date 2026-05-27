import { api } from './client';

/**
 * Cliente do módulo Social AI Studio.
 * Backend: apps/api/src/modules/social/.
 */

// ─── Tipos ────────────────────────────────────────

export type EmojiUsage = 'none' | 'minimal' | 'moderate' | 'heavy';
export type HashtagStrategy = 'niche' | 'broad' | 'mixed' | 'minimal';

export type CalendarObjective =
  | 'reach' | 'engagement' | 'leads' | 'sales'
  | 'authority' | 'launch' | 'remarketing';

export type ContentType =
  | 'post' | 'carousel' | 'reel' | 'story' | 'tiktok' | 'vsl' | 'ugc';
export type ContentStatus =
  | 'draft' | 'generating' | 'pending_approval' | 'approved'
  | 'rejected' | 'scheduled' | 'published' | 'failed';
export type ContentPillar =
  | 'educational' | 'promotional' | 'social_proof' | 'entertainment'
  | 'institutional' | 'engagement' | 'product' | 'behind_scenes';

export interface SocialBrand {
  id: string;
  org_id: string;
  name: string;
  slug: string;
  description: string | null;
  primary_color: string;
  secondary_color: string;
  logo_url: string | null;
  canva_brand_kit_id: string | null;
  niche: string | null;
  target_audience: string | null;
  value_proposition: string | null;
  pain_points: string[];
  differentials: string[];
  main_cta: string | null;
  tone_of_voice: string;
  forbidden_words: string[];
  preferred_words: string[];
  emoji_usage: EmojiUsage;
  hashtag_strategy: HashtagStrategy;
  persona_id: string | null;
  knowledge_categories: string[];
  reference_accounts: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialCalendar {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  start_date: string;
  end_date: string;
  channels: string[];
  objective: CalendarObjective;
  frequency_per_week: number;
  content_mix: Record<string, number>;
  status: 'draft' | 'active' | 'completed' | 'archived';
  generated_by_ai: boolean;
  created_at: string;
  updated_at: string;
}

export interface SocialContentSlide {
  slide_number: number;
  type: 'cover' | 'intro' | 'content' | 'cta';
  title?: string;
  subtitle?: string;
  body?: string;
  visual_prompt?: string;
  background_style?: string;
  cta_button?: string;
  image_url?: string | null;
}

export interface SocialContentMedia {
  url: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  alt_text?: string;
  source?: string;
}

export interface SocialContent {
  id: string;
  org_id: string;
  brand_id: string;
  calendar_id: string | null;
  content_type: ContentType;
  format_subtype: string | null;
  title: string | null;
  caption: string | null;
  hashtags: string[];
  cta: string | null;
  media: SocialContentMedia[];
  cover_image_url: string | null;
  slides: SocialContentSlide[];
  channels: string[];
  pillar: ContentPillar | null;
  campaign_tag: string | null;
  related_product_id: string | null;
  scheduled_for: string | null;
  scheduled_channels: string[] | null;
  status: ContentStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  version: number;
  parent_content_id: string | null;
  ai_model: string | null;
  ai_prompt: string | null;
  ai_generation_time_ms: number | null;
  published_at: string | null;
  external_post_ids: Record<string, unknown>;
  performance_metrics: Record<string, unknown>;
  publish_attempts_count: number;
  last_publish_error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface DashboardCounts {
  pending_approval: number;
  scheduled_next_7d: number;
  drafts: number;
  published_this_month: number;
  by_pillar: Record<string, number>;
  by_status: Record<string, number>;
}

export interface BrandContext {
  identity: {
    name: string;
    niche: string | null;
    value_proposition: string | null;
    target_audience: string | null;
    tone: string;
    primary_color: string;
    secondary_color: string;
    logo_url: string | null;
  };
  content_rules: {
    forbidden_words: string[];
    preferred_words: string[];
    emoji_usage: EmojiUsage;
    hashtag_strategy: HashtagStrategy;
  };
  business: {
    pain_points: string[];
    differentials: string[];
    main_cta: string | null;
  };
  knowledge_summary: string;
  persona: { name: string; system_prompt: string } | null;
}

export interface ExportPackage {
  filename: string;
  mime_type: string;
  caption_block: string;
  image_urls: string[];
  scheduled_for?: string;
  channels: string[];
}

export interface ListResponse<T> {
  rows: T[];
  total: number;
}

// ─── Publishing types ─────────────────────────────

export type PublishingChannel =
  | 'instagram_business' | 'tiktok_business' | 'facebook_page';

export interface SocialChannelCredential {
  id: string;
  org_id: string;
  brand_id: string | null;
  channel: PublishingChannel;
  external_account_id: string;
  external_username: string | null;
  external_account_name: string | null;
  expires_at: string | null;
  scopes: string[];
  metadata: Record<string, unknown>;
  is_active: boolean;
  last_validated_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialPublishAttempt {
  id: string;
  org_id: string;
  content_id: string;
  channel: string;
  credential_id: string | null;
  status: 'pending' | 'success' | 'failed' | 'partial';
  external_post_id: string | null;
  external_post_url: string | null;
  provider_response: Record<string, unknown>;
  error_message: string | null;
  error_code: string | null;
  attempted_at: string;
  completed_at: string | null;
  duration_ms: number | null;
}

export interface PublishContentResult {
  content_id: string;
  outcomes: Array<{
    channel: PublishingChannel;
    result: {
      success: boolean;
      external_post_id?: string;
      external_post_url?: string;
      error_message?: string;
      error_code?: string;
    };
  }>;
  any_success: boolean;
}

// ─── Analytics types ──────────────────────────────

export interface SocialMetricsDaily {
  id: string;
  org_id: string;
  content_id: string;
  brand_id: string | null;
  channel: string;
  external_post_id: string | null;
  date: string;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  profile_visits: number;
  profile_follows: number;
  video_views: number;
  total_interactions: number;
  engagement_rate: number;
  raw_metrics: Record<string, unknown>;
  fetched_at: string;
  created_at: string;
  updated_at: string;
}

export type SignalType =
  | 'hit_post' | 'flop_post' | 'best_time_window' | 'best_pillar'
  | 'best_hashtag' | 'declining_trend' | 'engagement_spike';

export interface SocialSignal {
  id: string;
  org_id: string;
  brand_id: string | null;
  content_id: string | null;
  signal_type: SignalType;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string | null;
  metric_name: string | null;
  metric_value: number | null;
  benchmark_value: number | null;
  delta_pct: number | null;
  detected_at: string;
  acknowledged_at: string | null;
  metadata: Record<string, unknown>;
}

export interface ReportSummary {
  posts_with_metrics: number;
  total_reach: number;
  total_impressions: number;
  total_likes: number;
  total_comments: number;
  total_shares: number;
  total_saved: number;
  total_profile_visits: number;
  total_profile_follows: number;
  avg_engagement_rate: number;
}

export interface PillarReportRow {
  pillar: string;
  total_posts: number;
  avg_engagement_rate: number;
  avg_reach: number;
  avg_likes: number;
  total_interactions: number;
}

export interface HourReportRow {
  hour_of_day: number;
  posts_count: number;
  avg_engagement_rate: number;
  avg_reach: number;
}

export interface TopPerformerRow {
  content_id: string;
  title: string | null;
  pillar: string | null;
  content_type: string;
  cover_image_url: string | null;
  total_reach: number;
  total_engagement: number;
  avg_engagement_rate: number;
}

// ─── Ad Boost types ────────────────────────────────

export type BoostObjective =
  | 'OUTCOME_AWARENESS' | 'OUTCOME_TRAFFIC' | 'OUTCOME_ENGAGEMENT'
  | 'OUTCOME_LEADS' | 'OUTCOME_APP_PROMOTION' | 'OUTCOME_SALES';

export type BoostStatus =
  | 'draft' | 'reviewed' | 'sent_to_platform' | 'live'
  | 'paused' | 'completed' | 'cancelled';

export interface SocialAdBoostDraft {
  id: string;
  org_id: string;
  content_id: string;
  brand_id: string | null;
  signal_id: string | null;
  platform: 'meta' | 'google' | 'tiktok_ads';
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
  daily_budget_cents: number;
  budget_rationale: string;
  duration_days: number;
  objective: BoostObjective;
  audience_summary: string;
  age_min: number;
  age_max: number;
  genders: string[];
  interests: string[];
  locations: string[];
  copy_suggestions: Array<{ caption: string; reason: string }>;
}

// ─── Hashtag analytics types ──────────────────────

export interface HashtagTopRow {
  hashtag: string;
  total_uses: number;
  avg_engagement_rate: number;
  avg_reach: number;
  avg_likes: number;
  total_interactions: number;
}

export interface HashtagDetailRow {
  content_id: string;
  title: string | null;
  pillar: string | null;
  cover_image_url: string | null;
  engagement_rate: number;
  reach: number;
  total_interactions: number;
  published_at: string;
}

export interface HashtagSuggestion {
  hashtags: string[];
  rationale: string;
  mix: 'niche' | 'broad' | 'mixed' | 'minimal';
}

// ─── Competitor analysis ──────────────────────────

export interface CompetitorAnalysis {
  id: string;
  org_id: string;
  brand_id: string;
  competitor_handles: string[];
  summary: string | null;
  strengths: Array<{ title: string; description: string }>;
  weaknesses: Array<{ title: string; description: string }>;
  opportunities: Array<{
    title: string;
    description: string;
    priority: 'high' | 'medium' | 'low';
  }>;
  competitor_estimates: Array<{
    handle: string;
    estimated_strategy: string;
    estimated_strengths: string[];
    differentiation_opportunity: string;
  }>;
  recommendations: Array<{
    action: string;
    rationale: string;
    effort: 'low' | 'medium' | 'high';
  }>;
  ai_model: string | null;
  ai_generation_time_ms: number | null;
  generated_at: string;
  created_at: string;
}

// ─── A/B Testing ──────────────────────────────────

export type AbTestStatus = 'draft' | 'running' | 'completed' | 'cancelled';
export type WinnerVariant = 'a' | 'b' | 'tie';

export interface SocialAbTest {
  id: string;
  org_id: string;
  brand_id: string;
  name: string;
  hypothesis: string | null;
  variant_a_content_id: string;
  variant_b_content_id: string;
  test_duration_days: number;
  status: AbTestStatus;
  winner_variant: WinnerVariant | null;
  winner_content_id: string | null;
  variant_a_engagement_rate: number | null;
  variant_b_engagement_rate: number | null;
  decision_rationale: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── API ──────────────────────────────────────────

export interface ContentListFilters {
  status?: ContentStatus | ContentStatus[];
  content_type?: ContentType;
  brand_id?: string;
  calendar_id?: string;
  pillar?: ContentPillar;
  search?: string;
  page?: number;
  page_size?: number;
}

function contentFiltersToQuery(
  f: ContentListFilters,
): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  if (f.status) {
    out.status = Array.isArray(f.status) ? f.status.join(',') : f.status;
  }
  if (f.content_type) out.content_type = f.content_type;
  if (f.brand_id) out.brand_id = f.brand_id;
  if (f.calendar_id) out.calendar_id = f.calendar_id;
  if (f.pillar) out.pillar = f.pillar;
  if (f.search) out.search = f.search;
  if (f.page) out.page = f.page;
  if (f.page_size) out.page_size = f.page_size;
  return out;
}

// ─── Autopilot de Campanha (Social Commerce AI) ───
export type CampaignAutonomy = 'draft' | 'approval' | 'full_auto';
export type CampaignStatus =
  | 'generating' | 'ready_for_review' | 'scheduled'
  | 'completed' | 'failed' | 'cancelled';
export type CampaignAssetType = 'reel' | 'carousel' | 'post';
export type CampaignAssetStatus =
  | 'pending' | 'generating' | 'ready' | 'failed'
  | 'approved' | 'scheduled' | 'published';

export interface SocialCampaignRecipe {
  id: string;
  org_id: string;
  brand_id: string | null;
  name: string;
  num_reels: number;
  num_carousels: number;
  num_posts: number;
  allowed_video_styles: string[];
  allowed_frameworks: string[];
  video_model: string;
  video_duration_seconds: number;
  channels: string[];
  cadence_days: number;
  preferred_hour: number;
  autonomy_level: CampaignAutonomy;
  prioritize_high_margin: boolean;
  prioritize_overstock: boolean;
  follow_radar: boolean;
  use_ai_influencer: boolean;
  auto_on_new_product: boolean;
  max_cost_usd: number;
  is_default: boolean;
  is_active: boolean;
  metadata?: {
    influencer_engine?: 'scene' | 'avatar';
    influencer_avatar_url?: string;
    influencer_voice?: string;
  } & Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface SocialCampaign {
  id: string;
  org_id: string;
  brand_id: string | null;
  recipe_id: string | null;
  name: string;
  product_ref: string | null;
  product_name: string | null;
  product_image_url: string | null;
  trigger_source: 'manual' | 'product_created' | 'batch';
  autonomy_level: CampaignAutonomy;
  status: CampaignStatus;
  planned_counts: { reels?: number; posts?: number; carousels?: number };
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface SocialCampaignAsset {
  id: string;
  org_id: string;
  campaign_id: string;
  content_id: string | null;
  asset_type: CampaignAssetType;
  planned_index: number;
  angle: string | null;
  style_id: string | null;
  framework_id: string | null;
  status: CampaignAssetStatus;
  scheduled_for: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CampaignDetail {
  campaign: SocialCampaign;
  assets: SocialCampaignAsset[];
  contents: SocialContent[];
}

export interface UpsertRecipePayload {
  brand_id?: string | null;
  name?: string;
  num_reels?: number;
  num_carousels?: number;
  num_posts?: number;
  allowed_video_styles?: string[];
  allowed_frameworks?: string[];
  video_model?: string;
  video_duration_seconds?: number;
  channels?: string[];
  cadence_days?: number;
  preferred_hour?: number;
  autonomy_level?: CampaignAutonomy;
  prioritize_high_margin?: boolean;
  prioritize_overstock?: boolean;
  follow_radar?: boolean;
  use_ai_influencer?: boolean;
  auto_on_new_product?: boolean;
  max_cost_usd?: number;
  is_default?: boolean;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CampaignStyleSpec {
  id: string;
  label: string;
  prompt: string;
  camera?: string;
}
export interface CampaignFrameworkSpec {
  id: string;
  label: string;
  prompt: string;
}
// ─── Estúdio de Estilos — overrides de prompts (B1) ───
export type PromptKind = 'video_style' | 'framework' | 'system_prompt';
export interface PromptOverride {
  id: string;
  org_id: string;
  kind: PromptKind;
  key: string;
  label: string | null;
  prompt: string;
  camera: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
export interface UpsertOverridePayload {
  kind: PromptKind;
  key: string;
  label?: string | null;
  prompt: string;
  camera?: string | null;
  is_active?: boolean;
}
export interface KnowledgeSource {
  id: string;
  org_id: string;
  scope: string;
  source_type: 'image' | 'url';
  value: string;
  title: string | null;
  extracted_text: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface LiveScriptSegment {
  product: string;
  hook: string;
  talking_points: string[];
  offer: string;
  cta: string;
}
export interface LiveScript {
  intro: string;
  structure: string;
  segments: LiveScriptSegment[];
  engagement_prompts: string[];
  closing: string;
}

export type CampaignStrategy = 'high_margin' | 'overstock' | 'radar' | 'mixed';
export interface GenerateBatchPayload {
  brand_id: string;
  recipe_id?: string | null;
  strategy?: CampaignStrategy;
  count?: number;
  video_styles?: CampaignStyleSpec[];
  frameworks?: CampaignFrameworkSpec[];
  num_reels?: number;
  num_posts?: number;
  num_carousels?: number;
}
export interface GenerateCampaignPayload {
  brand_id: string;
  recipe_id?: string | null;
  name?: string;
  product_ref: string;
  product_name: string;
  product_photo_url: string;
  product_photos?: string[];
  product_description?: string;
  category?: string;
  num_reels?: number;
  num_carousels?: number;
  num_posts?: number;
  video_styles?: CampaignStyleSpec[];
  frameworks?: CampaignFrameworkSpec[];
  video_model?: string;
  video_duration_seconds?: number;
  channels?: string[];
  cadence_days?: number;
  preferred_hour?: number;
  autonomy_level?: CampaignAutonomy;
  multi_scene?: boolean;
}

// ─── Social Intelligence (cérebro + dashboard) ────
export interface TodaySuggestion {
  product_id: string | null;
  product_name: string;
  format: 'reel' | 'post' | 'carousel';
  angle: string;
  why: string;
  best_time: string | null;
  photo_url: string | null;
}
export interface TodaysPlan {
  date: string;
  suggestions: TodaySuggestion[];
  signals: { candidates: number; best_format: string | null; best_hour: number | null; data_available: boolean };
  generated_at: string;
  cached: boolean;
}
export interface OrganicSummary {
  totals: { posts: number; reach: number; views: number; engagement: number; avg_engagement_rate: number; followers: number; profile_views: number };
  by_format: Array<{ format: string; posts: number; avg_reach: number; avg_engagement_rate: number }>;
  heatmap: Array<{ dow: number; hour: number; posts: number; reach: number }>;
  top_posts: Array<{ permalink: string | null; caption: string; type: string | null; thumbnail_url: string | null; reach: number; views: number; engagement_rate: number }>;
  trend: Array<{ date: string; reach: number; views: number }>;
  best_format: string | null;
  best_hour: number | null;
}
export interface IntelligenceOverview {
  organic: OrganicSummary | null;
  generated_at: string;
}
export interface WeekDaySlot {
  weekday: string;
  product_id: string | null;
  product_name: string;
  format: 'reel' | 'post' | 'carousel';
  angle: string;
  best_time: string | null;
}
export interface WeekPlan {
  week_start: string;
  days: WeekDaySlot[];
  generated_at: string;
  cached: boolean;
}
export interface Recommendation {
  id: string;
  kind: 'format' | 'timing' | 'campaign' | 'signal';
  severity: 'info' | 'opportunity' | 'warning';
  title: string;
  detail: string;
  action: { label: string; href: string } | null;
}
export interface AdsSummary {
  connected_accounts: number;
  period_days: number;
  totals: { spend: number; impressions: number; clicks: number; ctr: number; cpm: number; cpc: number; conversions: number; cac: number; roas: number };
  by_platform: Array<{ platform: string; spend: number; conversions: number }>;
  top_campaigns: Array<{ name: string; status: string; platform: string; spend: number; clicks: number; ctr: number; conversions: number; roas: number }>;
}
export interface SentimentSummary {
  analyzed: number;
  positive: number;
  neutral: number;
  negative: number;
  highlights: Array<{ sentiment: 'positive' | 'neutral' | 'negative'; theme: string; quote: string }>;
  generated_at: string;
  cached: boolean;
}

// ─── Radar de Conteúdo (Tendências + dados individuais) ───
export type TrendNetwork =
  | 'youtube' | 'meta_ads' | 'tiktok' | 'google_trends' | 'instagram';
export type TrendItemKind =
  | 'video' | 'short' | 'ad_creative' | 'sound' | 'hashtag' | 'search_term' | 'post';
export type TrendSignalType =
  | 'format_rising' | 'topic_rising' | 'sound_trending'
  | 'hashtag_trending' | 'competitor_active' | 'search_spike';

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
export interface TrendItemMetrics {
  views?: number; likes?: number; comments?: number; shares?: number;
  saves?: number; duration_sec?: number; growth_pct?: number;
  engagement_rate?: number; uses?: number;
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
  status: 'draft' | 'used' | 'dismissed';
  cost_usd: number;
  created_at: string;
  updated_at: string;
}
export interface TrendSourceStatus {
  source: TrendNetwork;
  label: string;
  status: 'live' | 'planned';
  phase: string;
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
export interface CreateMonitorPayload {
  network: TrendNetwork;
  category: string;
  keywords?: string[];
  competitors?: TrendCompetitor[];
  region?: string;
  language?: string;
  brand_id?: string | null;
}
export interface UpdateMonitorPayload {
  category?: string;
  keywords?: string[];
  competitors?: TrendCompetitor[];
  region?: string;
  language?: string;
  is_active?: boolean;
}

export const socialApi = {
  // Brands
  brands: {
    list: (signal?: AbortSignal) =>
      api.get<SocialBrand[]>('/social/brands', { signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<SocialBrand>(`/social/brands/${id}`, { signal }),
    create: (body: Partial<SocialBrand> & { name: string }) =>
      api.post<SocialBrand>('/social/brands', body),
    update: (id: string, body: Partial<SocialBrand>) =>
      api.patch<SocialBrand>(`/social/brands/${id}`, body),
    delete: (id: string) => api.delete<void>(`/social/brands/${id}`),
    context: (id: string, signal?: AbortSignal) =>
      api.get<BrandContext>(`/social/brands/${id}/context`, { signal }),
    syncPersona: (id: string) =>
      api.post<SocialBrand>(`/social/brands/${id}/sync-persona`, {}),
  },

  // Calendars
  calendars: {
    list: (params: { brand_id?: string; status?: string } = {}, signal?: AbortSignal) =>
      api.get<SocialCalendar[]>('/social/calendars', { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<SocialCalendar>(`/social/calendars/${id}`, { signal }),
    create: (body: Partial<SocialCalendar> & { brand_id: string; name: string; start_date: string; end_date: string }) =>
      api.post<SocialCalendar>('/social/calendars', body),
    update: (id: string, body: Partial<SocialCalendar>) =>
      api.patch<SocialCalendar>(`/social/calendars/${id}`, body),
    delete: (id: string) => api.delete<void>(`/social/calendars/${id}`),
    generate: (body: {
      brand_id: string;
      start_date: string;
      duration_days: 7 | 15 | 30;
      channels: string[];
      objective: CalendarObjective;
      frequency_per_week: number;
      content_mix?: Record<string, number>;
      special_dates?: Array<{ date: string; theme: string }>;
      campaigns?: Array<{ name: string; start: string; end: string }>;
    }) =>
      api.post<{ calendar_id: string; items_created: number; items: unknown[] }>(
        '/social/calendars/generate',
        body,
      ),
  },

  // Contents
  contents: {
    list: (filters: ContentListFilters = {}, signal?: AbortSignal) =>
      api.get<ListResponse<SocialContent>>('/social/contents', {
        query: contentFiltersToQuery(filters),
        signal,
      }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<SocialContent>(`/social/contents/${id}`, { signal }),
    versions: (id: string, signal?: AbortSignal) =>
      api.get<SocialContent[]>(`/social/contents/${id}/versions`, { signal }),
    dashboard: (signal?: AbortSignal) =>
      api.get<DashboardCounts>('/social/contents/dashboard', { signal }),
    create: (body: Partial<SocialContent> & { brand_id: string; content_type: ContentType }) =>
      api.post<SocialContent>('/social/contents', body),
    update: (id: string, body: Partial<SocialContent>) =>
      api.patch<SocialContent>(`/social/contents/${id}`, body),
    delete: (id: string) => api.delete<void>(`/social/contents/${id}`),
    approve: (id: string) => api.post<SocialContent>(`/social/contents/${id}/approve`, {}),
    reject: (id: string, reason?: string) =>
      api.post<SocialContent>(`/social/contents/${id}/reject`, { reason }),
    schedule: (id: string, body: { scheduled_for: string; channels?: string[] }) =>
      api.post<SocialContent>(`/social/contents/${id}/schedule`, body),
    unschedule: (id: string) =>
      api.post<SocialContent>(`/social/contents/${id}/unschedule`, {}),
    duplicate: (id: string) =>
      api.post<SocialContent>(`/social/contents/${id}/duplicate`, {}),
    export: (id: string) =>
      api.post<ExportPackage>(`/social/contents/${id}/export`, {}),

    // AI ops
    generate: (id: string) =>
      api.post<SocialContent>(`/social/contents/${id}/generate`, {}),
    regenerate: (id: string, body: { instruction?: string; scope?: 'all' | 'caption_only' | 'images_only' }) =>
      api.post<SocialContent>(`/social/contents/${id}/regenerate`, body),
    rewriteCaption: (id: string, instruction: string) =>
      api.post<SocialContent>(`/social/contents/${id}/rewrite-caption`, { instruction }),
    suggestImprovements: (id: string) =>
      api.post<{ suggestions: string[] }>(
        `/social/contents/${id}/suggest-improvements`,
        {},
      ),
  },

  // Publishing — credenciais
  credentials: {
    list: (signal?: AbortSignal) =>
      api.get<SocialChannelCredential[]>('/social/credentials', { signal }),
    save: (body: {
      channel: PublishingChannel;
      brand_id?: string;
      external_account_id: string;
      external_username?: string;
      external_account_name?: string;
      access_token: string;
      refresh_token?: string;
      expires_at?: string;
      scopes?: string[];
    }) => api.post<SocialChannelCredential>('/social/credentials', body),
    delete: (id: string) => api.delete<void>(`/social/credentials/${id}`),
    deactivate: (id: string) =>
      api.post<void>(`/social/credentials/${id}/deactivate`, {}),
  },

  // Publishing — conexão OAuth (TikTok rede social / Content Posting API)
  connect: {
    /** Retorna a URL do TikTok pra iniciar o OAuth de publicação. */
    tiktokAuthUrl: () =>
      api.get<{ url: string }>('/social/connect/tiktok/auth'),
  },

  // Publishing — actions
  publish: {
    now: (id: string) =>
      api.post<PublishContentResult>(`/social/contents/${id}/publish-now`, {}),
    attempts: (id: string, signal?: AbortSignal) =>
      api.get<SocialPublishAttempt[]>(
        `/social/contents/${id}/publish-attempts`,
        { signal },
      ),
  },

  // Analytics — reports
  reports: {
    summary: (params: { days?: number; brand_id?: string } = {}, signal?: AbortSignal) =>
      api.get<ReportSummary>('/social/reports/summary', { query: params, signal }),
    byPillar: (params: { days?: number; brand_id?: string } = {}, signal?: AbortSignal) =>
      api.get<PillarReportRow[]>('/social/reports/by-pillar', { query: params, signal }),
    byHour: (params: { days?: number; brand_id?: string } = {}, signal?: AbortSignal) =>
      api.get<HourReportRow[]>('/social/reports/by-hour', { query: params, signal }),
    topPerformers: (params: { days?: number; brand_id?: string; limit?: number } = {}, signal?: AbortSignal) =>
      api.get<TopPerformerRow[]>('/social/reports/top-performers', { query: params, signal }),
    contentMetrics: (id: string, signal?: AbortSignal) =>
      api.get<SocialMetricsDaily[]>(`/social/contents/${id}/metrics`, { signal }),
    refresh: () => api.post<{ refreshed: number; failed: number }>('/social/reports/refresh', {}),
  },

  // Analytics — signals
  signals: {
    list: (onlyUnacked = false, signal?: AbortSignal) =>
      api.get<SocialSignal[]>('/social/signals', {
        query: onlyUnacked ? { only_unacked: 'true' } : undefined,
        signal,
      }),
    acknowledge: (id: string) =>
      api.post<void>(`/social/signals/${id}/acknowledge`, {}),
    detect: () =>
      api.post<{ created: number }>('/social/signals/detect', {}),
  },

  // Hashtag analytics
  hashtags: {
    top: (params: { brand_id?: string; days?: number; limit?: number } = {}, signal?: AbortSignal) =>
      api.get<HashtagTopRow[]>('/social/hashtags/top', { query: params, signal }),
    detail: (hashtag: string, params: { brand_id?: string; days?: number } = {}, signal?: AbortSignal) =>
      api.get<HashtagDetailRow[]>(
        `/social/hashtags/detail/${encodeURIComponent(hashtag)}`,
        { query: params, signal },
      ),
    suggest: (body: { theme: string; brand_id: string }) =>
      api.post<HashtagSuggestion>('/social/hashtags/suggest', body),
  },

  // Competitor analysis
  competitor: {
    latest: (brandId: string, signal?: AbortSignal) =>
      api.get<CompetitorAnalysis | null>(
        `/social/brands/${brandId}/competitor-analysis`,
        { signal },
      ),
    generate: (brandId: string) =>
      api.post<CompetitorAnalysis>(
        `/social/brands/${brandId}/competitor-analysis`,
        {},
      ),
  },

  // Social Intelligence — cérebro "o que postar hoje" + dashboard executivo
  intelligence: {
    today: (signal?: AbortSignal) =>
      api.get<TodaysPlan>('/social/intelligence/today', { signal }),
    refreshToday: () =>
      api.post<TodaysPlan>('/social/intelligence/today/refresh', {}),
    overview: (signal?: AbortSignal) =>
      api.get<IntelligenceOverview>('/social/intelligence/overview', { signal }),
    week: (signal?: AbortSignal) =>
      api.get<WeekPlan>('/social/intelligence/week', { signal }),
    refreshWeek: () =>
      api.post<WeekPlan>('/social/intelligence/week/refresh', {}),
    recommendations: (signal?: AbortSignal) =>
      api.get<Recommendation[]>('/social/intelligence/recommendations', { signal }),
    ads: (signal?: AbortSignal) =>
      api.get<AdsSummary>('/social/intelligence/ads', { signal }),
    sentiment: (signal?: AbortSignal) =>
      api.get<SentimentSummary>('/social/intelligence/sentiment', { signal }),
  },

  // Radar de Conteúdo — tendências + dados individuais por item
  trends: {
    overview: (signal?: AbortSignal) =>
      api.get<TrendsOverview>('/social/trends/overview', { signal }),
    monitors: (signal?: AbortSignal) =>
      api.get<TrendMonitor[]>('/social/trends/monitors', { signal }),
    createMonitor: (body: CreateMonitorPayload) =>
      api.post<TrendMonitor>('/social/trends/monitors', body),
    updateMonitor: (id: string, body: UpdateMonitorPayload) =>
      api.patch<TrendMonitor>(`/social/trends/monitors/${id}`, body),
    deleteMonitor: (id: string) =>
      api.delete<void>(`/social/trends/monitors/${id}`),
    items: (
      params: {
        source?: TrendNetwork;
        category?: string;
        kind?: TrendItemKind;
        monitor_id?: string;
        limit?: number;
      } = {},
      signal?: AbortSignal,
    ) => api.get<TrendItem[]>('/social/trends/items', { query: params, signal }),
    item: (id: string, signal?: AbortSignal) =>
      api.get<TrendItem>(`/social/trends/items/${id}`, { signal }),
    signals: (signal?: AbortSignal) =>
      api.get<TrendSignal[]>('/social/trends/signals', { signal }),
    briefs: (signal?: AbortSignal) =>
      api.get<TrendBrief[]>('/social/trends/briefs', { signal }),
  },

  // A/B Testing
  abTests: {
    list: (
      params: { status?: AbTestStatus; brand_id?: string } = {},
      signal?: AbortSignal,
    ) =>
      api.get<SocialAbTest[]>('/social/ab-tests', { query: params, signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<SocialAbTest>(`/social/ab-tests/${id}`, { signal }),
    create: (body: {
      brand_id: string;
      name: string;
      hypothesis?: string;
      theme: string;
      pillar?: ContentPillar;
      content_type?: 'post' | 'carousel';
      test_duration_days?: number;
    }) => api.post<SocialAbTest>('/social/ab-tests', body),
    start: (id: string) =>
      api.post<SocialAbTest>(`/social/ab-tests/${id}/start`, {}),
    evaluate: (id: string) =>
      api.post<SocialAbTest>(`/social/ab-tests/${id}/evaluate`, {}),
    cancel: (id: string) =>
      api.post<SocialAbTest>(`/social/ab-tests/${id}/cancel`, {}),
  },

  // Ad Boost — promover post como ad
  boost: {
    suggest: (contentId: string, signal?: AbortSignal) =>
      api.get<BoostSuggestion>(`/social/contents/${contentId}/boost-suggestion`, {
        signal,
      }),
    createDraft: (contentId: string, signalId?: string) =>
      api.post<SocialAdBoostDraft>(
        `/social/contents/${contentId}/boost-draft`,
        signalId ? { signal_id: signalId } : {},
      ),
    listDrafts: (
      params: { status?: BoostStatus; content_id?: string } = {},
      signal?: AbortSignal,
    ) =>
      api.get<SocialAdBoostDraft[]>('/social/boost-drafts', {
        query: params,
        signal,
      }),
    getDraft: (id: string, signal?: AbortSignal) =>
      api.get<SocialAdBoostDraft>(`/social/boost-drafts/${id}`, { signal }),
    updateDraft: (id: string, body: Partial<SocialAdBoostDraft>) =>
      api.patch<SocialAdBoostDraft>(`/social/boost-drafts/${id}`, body),
    markSent: (id: string) =>
      api.post<SocialAdBoostDraft>(`/social/boost-drafts/${id}/sent`, {}),
    deleteDraft: (id: string) =>
      api.delete<void>(`/social/boost-drafts/${id}`),
  },

  // Generation atalhos (cria + gera num call só)
  generate: {
    post: (body: {
      brand_id: string;
      theme: string;
      pillar?: ContentPillar;
      hook?: string;
      cta?: string;
      visual_style?: string;
      channels?: string[];
      calendar_id?: string;
    }) => api.post<SocialContent>('/social/generate/post', body),
    carousel: (body: {
      brand_id: string;
      theme: string;
      pillar?: ContentPillar;
      hook?: string;
      cta?: string;
      slide_count?: number;
      structure?:
        | 'tutorial' | 'storytelling' | 'list'
        | 'comparison' | 'before_after' | 'free';
      channels?: string[];
      calendar_id?: string;
    }) => api.post<SocialContent>('/social/generate/carousel', body),
    reel: (body: {
      brand_id: string;
      theme: string;
      pillar?: ContentPillar;
      hook?: string;
      cta?: string;
      channels?: string[];
      calendar_id?: string;
      catalog_product_id?: string;
      product_title?: string;
      product_photo_url: string;
      category?: string;
      product_description?: string;
      video_mode: 'product_photo' | 'ai_scene';
      style?: string;
      style_label?: string;
      style_prompt?: string;
      framework?: string;
      framework_label?: string;
      framework_prompt?: string;
      aspect_ratio?: '1:1' | '16:9' | '9:16';
      duration_seconds?: number;
      model_name?: string;
      camera_motion?: string;
      multi_scene?: boolean;
      photo_urls?: string[];
      avatar_overlay?: boolean;
      avatar_voice?: string;
      avatar_image_url?: string;
      avatar_position?: 'br' | 'bl' | 'tr' | 'tl';
      avatar_size_pct?: number;
    }) => api.post<SocialContent>('/social/generate/reel', body),
  },

  /** Poll do vídeo do reel (até video_status='completed'). */
  reelStatus: (id: string) =>
    api.get<{ content: SocialContent; video_status: string }>(
      `/social/contents/${id}/reel-status`,
    ),

  // Autopilot — receitas de campanha
  recipes: {
    list: (signal?: AbortSignal) =>
      api.get<SocialCampaignRecipe[]>('/social/campaign-recipes', { signal }),
    getDefault: (signal?: AbortSignal) =>
      api.get<SocialCampaignRecipe>('/social/campaign-recipes/default', {
        signal,
      }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<SocialCampaignRecipe>(`/social/campaign-recipes/${id}`, { signal }),
    create: (body: UpsertRecipePayload) =>
      api.post<SocialCampaignRecipe>('/social/campaign-recipes', body),
    update: (id: string, body: UpsertRecipePayload) =>
      api.patch<SocialCampaignRecipe>(`/social/campaign-recipes/${id}`, body),
    delete: (id: string) =>
      api.delete<{ ok: boolean }>(`/social/campaign-recipes/${id}`),
  },

  // Autopilot — campanhas
  campaigns: {
    generate: (body: GenerateCampaignPayload) =>
      api.post<SocialCampaign>('/social/campaigns/generate', body),
    generateBatch: (body: GenerateBatchPayload) =>
      api.post<{ campaigns: SocialCampaign[]; skipped: number }>(
        '/social/campaigns/generate-batch',
        body,
      ),
    list: (signal?: AbortSignal) =>
      api.get<SocialCampaign[]>('/social/campaigns', { signal }),
    get: (id: string, signal?: AbortSignal) =>
      api.get<CampaignDetail>(`/social/campaigns/${id}`, { signal }),
    approve: (id: string) =>
      api.post<CampaignDetail>(`/social/campaigns/${id}/approve`, {}),
    cancel: (id: string) =>
      api.post<SocialCampaign>(`/social/campaigns/${id}/cancel`, {}),
    createAds: (id: string) =>
      api.post<{ created: number }>(`/social/campaigns/${id}/ads`, {}),
  },

  // Estúdio de Estilos — base de conhecimento (B2)
  knowledge: {
    list: (scope?: string, signal?: AbortSignal) =>
      api.get<KnowledgeSource[]>('/social/knowledge', {
        query: scope ? { scope } : undefined,
        signal,
      }),
    add: (body: {
      scope?: string;
      source_type: 'image' | 'url';
      value: string;
      title?: string;
    }) => api.post<KnowledgeSource>('/social/knowledge', body),
    remove: (id: string) =>
      api.delete<{ ok: boolean }>(`/social/knowledge/${id}`),
  },

  // Estúdio de Estilos — overrides de prompts (B1)
  prompts: {
    list: (signal?: AbortSignal) =>
      api.get<PromptOverride[]>('/social/prompts', { signal }),
    upsert: (body: UpsertOverridePayload) =>
      api.put<PromptOverride>('/social/prompts', body),
    reset: (kind: PromptKind, key: string) =>
      api.delete<{ ok: boolean }>(
        `/social/prompts/${kind}/${encodeURIComponent(key)}`,
      ),
    generate: (body: {
      kind: PromptKind;
      key: string;
      instruction: string;
      current_prompt?: string;
      label?: string;
    }) => api.post<{ prompt: string }>('/social/prompts/generate', body),
  },

  // Co-piloto de live (Fase 4)
  live: {
    script: (body: {
      brand_id: string;
      products: Array<{ name: string; ref?: string; price?: number | null }>;
      duration_min?: number;
      objective?: string;
    }) => api.post<LiveScript>('/social/live/script', body),
  },
};
