import { api } from './client';

export type ContentType =
  | 'social_post'
  | 'story'
  | 'reel'
  | 'tiktok'
  | 'email'
  | 'whatsapp_broadcast'
  | 'ad_launch';

export type ContentChannel =
  | 'instagram'
  | 'facebook'
  | 'tiktok'
  | 'whatsapp'
  | 'email'
  | 'meta_ads'
  | 'google_ads';

export type ContentStatus =
  | 'idea'
  | 'planned'
  | 'content_ready'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'cancelled';

export interface ContentCalendarEvent {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  content_type: ContentType;
  channel: ContentChannel;
  product_id: string | null;
  social_content_id: string | null;
  ads_campaign_id: string | null;
  scheduled_date: string;
  scheduled_time: string | null;
  timezone: string;
  status: ContentStatus;
  notes: string | null;
  color: string | null;
  resource_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ListEventsFilter {
  from?: string;
  to?: string;
  channel?: ContentChannel;
  status?: ContentStatus;
}

export interface CreateEventInput {
  title: string;
  content_type: ContentType;
  channel: ContentChannel;
  scheduled_date: string;
  scheduled_time?: string | null;
  timezone?: string;
  product_id?: string | null;
  social_content_id?: string | null;
  ads_campaign_id?: string | null;
  status?: ContentStatus;
  notes?: string | null;
  color?: string | null;
  resource_snapshot?: Record<string, unknown>;
}

export type UpdateEventInput = Partial<CreateEventInput>;

export interface GeneratePlanInput {
  period: 'week' | 'month';
  start_date: string;
  channels: ContentChannel[];
  business_context?: string;
  product_ids?: string[];
  product_snapshots?: Array<{
    id: string;
    name: string;
    description?: string;
    short_description?: string;
  }>;
}

export interface GeneratePlanResult {
  events: ContentCalendarEvent[];
  cost_usd: number;
  generated_count: number;
}

export const contentCalendarApi = {
  list(filter: ListEventsFilter = {}): Promise<ContentCalendarEvent[]> {
    const query: Record<string, string> = {};
    if (filter.from) query.from = filter.from;
    if (filter.to) query.to = filter.to;
    if (filter.channel) query.channel = filter.channel;
    if (filter.status) query.status = filter.status;
    return api.get<ContentCalendarEvent[]>('/content-calendar', { query });
  },
  create(body: CreateEventInput): Promise<ContentCalendarEvent> {
    return api.post<ContentCalendarEvent>('/content-calendar', body);
  },
  update(id: string, body: UpdateEventInput): Promise<ContentCalendarEvent> {
    return api.patch<ContentCalendarEvent>(`/content-calendar/${id}`, body);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/content-calendar/${id}`);
  },
  generatePlan(body: GeneratePlanInput): Promise<GeneratePlanResult> {
    return api.post<GeneratePlanResult>('/content-calendar/generate-plan', body);
  },
};

// ──────────────────────────────────────────────────────────
// Helpers visuais (cores + labels)
// ──────────────────────────────────────────────────────────

export const CHANNEL_COLOR: Record<ContentChannel, string> = {
  instagram: '#E1306C',
  facebook: '#1877F2',
  tiktok: '#000000',
  whatsapp: '#25D366',
  email: '#6b7280',
  meta_ads: '#0866FF',
  google_ads: '#4285F4',
};

export const CHANNEL_LABEL: Record<ContentChannel, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  whatsapp: 'WhatsApp',
  email: 'E-mail',
  meta_ads: 'Meta Ads',
  google_ads: 'Google Ads',
};

export const CONTENT_TYPE_LABEL: Record<ContentType, string> = {
  social_post: 'Post',
  story: 'Story',
  reel: 'Reel',
  tiktok: 'Vídeo TikTok',
  email: 'E-mail',
  whatsapp_broadcast: 'Broadcast WhatsApp',
  ad_launch: 'Anúncio',
};

export const STATUS_LABEL: Record<ContentStatus, string> = {
  idea: 'Ideia',
  planned: 'Planejado',
  content_ready: 'Conteúdo pronto',
  approved: 'Aprovado',
  scheduled: 'Agendado',
  published: 'Publicado',
  cancelled: 'Cancelado',
};
