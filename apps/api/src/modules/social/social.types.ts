/**
 * Tipos do módulo Social AI Studio.
 * Espelham os CHECK constraints da migration 054.
 */

export type EmojiUsage = 'none' | 'minimal' | 'moderate' | 'heavy';
export type HashtagStrategy = 'niche' | 'broad' | 'mixed' | 'minimal';

export type CalendarObjective =
  | 'reach' | 'engagement' | 'leads' | 'sales'
  | 'authority' | 'launch' | 'remarketing';
export type CalendarStatus = 'draft' | 'active' | 'completed' | 'archived';

export type ContentType =
  | 'post' | 'carousel' | 'reel' | 'story' | 'tiktok' | 'vsl' | 'ugc';
export type ContentStatus =
  | 'draft' | 'generating' | 'pending_approval' | 'approved'
  | 'rejected' | 'scheduled' | 'published' | 'failed';

export type ContentPillar =
  | 'educational' | 'promotional' | 'social_proof' | 'entertainment'
  | 'institutional' | 'engagement' | 'product' | 'behind_scenes';

export type AssetType = 'image' | 'video' | 'audio' | 'template' | 'inspiration';
export type AssetSource =
  | 'generated_ai' | 'canva' | 'upload' | 'inspiration_url' | 'placeholder';

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
  inspiration_urls: unknown;
  reference_accounts: string[];
  is_active: boolean;
  metadata: Record<string, unknown>;
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
  status: CalendarStatus;
  generated_by_ai: boolean;
  ai_generation_prompt: string | null;
  metadata: Record<string, unknown>;
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
  /** Caminho no bucket social-media — permite re-assinar a URL quando vence */
  storage_path?: string;
  thumbnail_url?: string;
  width?: number;
  height?: number;
  source?: AssetSource;
  alt_text?: string;
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

export interface SocialPromptTemplate {
  id: string;
  org_id: string | null;
  name: string;
  content_type: string;
  pillar: string | null;
  prompt_template: string;
  variables: string[];
  is_system: boolean;
  usage_count: number;
  created_at: string;
}

export interface SocialAsset {
  id: string;
  org_id: string;
  brand_id: string | null;
  name: string;
  asset_type: AssetType;
  url: string;
  thumbnail_url: string | null;
  source: AssetSource;
  ai_provider: string | null;
  width: number | null;
  height: number | null;
  used_in_contents: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  created_at: string;
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

export interface CalendarItemDraft {
  date: string;
  time: string;
  channel: string;
  content_type: ContentType;
  pillar: ContentPillar;
  theme: string;
  hook: string;
  brief: string;
  cta: string;
  hashtags_suggested: string[];
  needs_image: boolean;
}

export interface DashboardCounts {
  pending_approval: number;
  scheduled_next_7d: number;
  drafts: number;
  published_this_month: number;
  by_pillar: Record<string, number>;
  by_status: Record<string, number>;
}
