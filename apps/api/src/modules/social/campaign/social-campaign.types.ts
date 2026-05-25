/**
 * Tipos do Autopilot de Campanha (Social Commerce AI — Fase 1).
 * Espelham os CHECK constraints da migration 076.
 */

export type CampaignAutonomy = 'draft' | 'approval' | 'full_auto';
export type CampaignTrigger = 'manual' | 'product_created' | 'batch';
export type CampaignStatus =
  | 'generating'
  | 'ready_for_review'
  | 'scheduled'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type CampaignAssetType = 'reel' | 'carousel' | 'post';
export type CampaignAssetStatus =
  | 'pending'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'approved'
  | 'scheduled'
  | 'published';

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
  metadata: Record<string, unknown> & {
    influencer_engine?: 'scene' | 'avatar';
    influencer_avatar_url?: string;
    influencer_voice?: string;
  };
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
  trigger_source: CampaignTrigger;
  autonomy_level: CampaignAutonomy;
  status: CampaignStatus;
  planned_counts: { reels?: number; posts?: number; carousels?: number };
  estimated_cost_usd: number | null;
  actual_cost_usd: number | null;
  error_message: string | null;
  created_by: string | null;
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
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** Resposta do detalhe de uma campanha (campanha + peças + conteúdos). */
export interface CampaignDetail {
  campaign: SocialCampaign;
  assets: SocialCampaignAsset[];
  contents: import('../social.types').SocialContent[];
}
