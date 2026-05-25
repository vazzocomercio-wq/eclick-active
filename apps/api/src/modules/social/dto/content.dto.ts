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

export interface GenerateReelDto {
  brand_id: string;
  theme: string;
  pillar?: ContentPillar;
  hook?: string;
  cta?: string;
  channels?: string[];
  calendar_id?: string;
  /** Produto do catálogo (foto vira 1º quadro do vídeo). */
  catalog_product_id?: string;
  product_title?: string;
  product_photo_url: string;
  category?: string;
  /** Descrição do produto (E2) — enriquece o roteiro/legenda. */
  product_description?: string;
  /** product_photo = anima a foto real; ai_scene = gera cena por IA e anima. */
  video_mode: 'product_photo' | 'ai_scene';
  /** Estilo do vídeo (catálogo do front): id + rótulo + dica de prompt. */
  style?: string;
  style_label?: string;
  style_prompt?: string;
  /** Estrutura de roteiro (D+S+B, AIDA, PAS…): id + rótulo + dica. */
  framework?: string;
  framework_label?: string;
  framework_prompt?: string;
  aspect_ratio?: '1:1' | '16:9' | '9:16';
  duration_seconds?: number;
  model_name?: string;
  camera_motion?: string;
  /** E3 — multi-cena: anima várias fotos e concatena num reel só. */
  multi_scene?: boolean;
  photo_urls?: string[];
  /** UGC com avatar (D-ID): produto no fundo + avatar pequeno falando o texto.
   *  Gera o vídeo do produto E o avatar; o SaaS faz o overlay (picture-in-picture). */
  avatar_overlay?: boolean;
  avatar_voice?: string;
  avatar_image_url?: string;
  avatar_position?: 'br' | 'bl' | 'tr' | 'tl';
  avatar_size_pct?: number;
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
