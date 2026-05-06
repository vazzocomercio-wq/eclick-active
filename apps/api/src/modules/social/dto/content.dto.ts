import type {
  ContentType,
  ContentPillar,
  ContentStatus,
  SocialContentSlide,
  SocialContentMedia,
} from '../social.types';

export interface CreateContentDto {
  brand_id: string;
  calendar_id?: string | null;
  content_type: ContentType;
  pillar?: ContentPillar;
  title?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  channels?: string[];
  campaign_tag?: string;
  related_product_id?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateContentDto {
  title?: string;
  caption?: string;
  hashtags?: string[];
  cta?: string;
  pillar?: ContentPillar;
  channels?: string[];
  campaign_tag?: string;
  scheduled_for?: string | null;
  scheduled_channels?: string[] | null;
  status?: ContentStatus;
  cover_image_url?: string | null;
  media?: SocialContentMedia[];
  slides?: SocialContentSlide[];
}

export interface GeneratePostDto {
  brand_id: string;
  pillar?: ContentPillar;
  theme: string;
  hook?: string;
  cta?: string;
  visual_style?: string;
  related_product_id?: string;
  channels?: string[];
  calendar_id?: string;
}

export interface GenerateCarouselDto extends GeneratePostDto {
  slide_count?: number;
  structure?:
    | 'tutorial'
    | 'storytelling'
    | 'list'
    | 'comparison'
    | 'before_after'
    | 'free';
}

export interface ScheduleContentDto {
  scheduled_for: string;
  channels?: string[];
}

export interface RejectContentDto {
  reason?: string;
}

export interface RegenerateContentDto {
  instruction?: string;
  /** Se 'caption_only', mantém imagem e refaz só copy. */
  scope?: 'all' | 'caption_only' | 'images_only';
}
