/**
 * Tipos do módulo Content Calendar (S5 — Onda 3).
 *
 * `active.content_calendar` é uma tabela de PLANEJAMENTO. Active não publica
 * — o SaaS é quem executa quando `scheduled_at` chega. Por isso as FKs pra
 * SaaS (product_id / social_content_id / ads_campaign_id) são lógicas
 * (UUID sem REFERENCES).
 */

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
  scheduled_date: string; // YYYY-MM-DD
  scheduled_time: string | null; // HH:MM:SS ou null
  timezone: string;
  status: ContentStatus;
  notes: string | null;
  color: string | null;
  /**
   * Snapshot opcional de info do recurso vinculado (nome do produto,
   * thumbnail) — preenchido pela UI ao linkar pra resiliência se SaaS
   * cair.
   */
  resource_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ListEventsFilter {
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
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

export type UpdateEventInput = Partial<
  Omit<CreateEventInput, 'channel' | 'content_type'>
> & {
  channel?: ContentChannel;
  content_type?: ContentType;
};

export interface GeneratePlanInput {
  period: 'week' | 'month';
  start_date: string; // YYYY-MM-DD
  channels: ContentChannel[];
  business_context?: string;
  /** UUIDs de produtos no SaaS — opcional, se vier IA usa nos posts. */
  product_ids?: string[];
  /**
   * Snapshots opcionais dos produtos (nome, descrição, etc) — frontend já
   * pode passar pra evitar fetch SaaS no backend.
   */
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
  /** Quantos eventos a IA gerou antes do INSERT (alguns podem ter falhado). */
  generated_count: number;
}
