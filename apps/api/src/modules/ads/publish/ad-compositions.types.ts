/** Tipos do bloco Publish (Onda 1) — campanhas autoradas no Active. */

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

export interface AdCopy {
  /** 'A' | 'B' | 'C' */
  variant: string;
  headline: string;
  primary_text: string;
  description?: string;
  /** SHOP_NOW | LEARN_MORE | SIGN_UP | ... (enum CTA do Meta). */
  cta: string;
  /** ângulo psicológico do copy (uso interno/IA). */
  angle?: string;
  /** URL da imagem do criativo (produto). */
  image_url?: string;
  /** hash retornado por /adimages após upload. */
  image_hash?: string;
}

/** Card de carrossel. */
export interface AdCard {
  image_url?: string;
  image_hash?: string;
  headline?: string;
  description?: string;
  /** link próprio do card (senão usa destination_url). */
  link?: string;
}

/** Vídeo do anúncio (reels/feed). */
export interface AdVideo {
  url?: string;
  /** id no Meta após upload em /advideos. */
  video_id?: string;
  thumbnail_url?: string;
  duration_sec?: number;
  width?: number;
  height?: number;
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
  /** ref. solta ao social_content reusado. */
  content_id: string | null;
  /** post FB já publicado (page_post_id) p/ promover como anúncio. */
  object_story_id: string | null;
  /** carrossel. */
  cards: AdCard[];
  /** vídeo/reels. */
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

/** Página do Facebook elegível pra assinar o anúncio. */
export interface MetaPage {
  id: string;
  name: string;
  /** ID da conta IG business vinculada (pra veicular tb no Instagram). */
  instagram_actor_id: string | null;
}

export interface PublishResult {
  campaign_id: string;
  adset_id: string;
  ad_ids: string[];
}
