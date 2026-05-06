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
  },
};
