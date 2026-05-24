import type { CampaignAutonomy } from '../social-campaign.types';

/** Criação/edição da receita (painel /social/automacao). */
export interface UpsertRecipeDto {
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
}

/** Estilo de vídeo resolvido pelo front (catálogo video-styles.ts). */
export interface CampaignStyleSpec {
  id: string;
  label: string;
  prompt: string;
  camera?: string;
}

/** Framework de roteiro resolvido pelo front. */
export interface CampaignFrameworkSpec {
  id: string;
  label: string;
  prompt: string;
}

/**
 * Dispara uma campanha completa pra um produto. O front (que tem o catálogo
 * de estilos) resolve os estilos/frameworks e manda tudo pronto. Se vier
 * recipe_id, o backend completa o que faltar com os valores da receita.
 */
export interface GenerateCampaignDto {
  brand_id: string;
  recipe_id?: string | null;
  name?: string;

  // Produto-alvo (vem do product picker do /social/criar)
  product_ref: string;
  product_name: string;
  product_photo_url: string;
  product_photos?: string[];
  product_description?: string;
  category?: string;

  // Receita resolvida (front manda; recipe_id como fallback no backend)
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
  /** Reels multi-cena: anima várias fotos do produto e concatena. */
  multi_scene?: boolean;
}

/** Geração em lote: a IA escolhe os top-N produtos por estratégia comercial. */
export interface GenerateBatchDto {
  brand_id: string;
  recipe_id?: string | null;
  strategy?: 'high_margin' | 'overstock' | 'radar' | 'mixed';
  count?: number;
  video_styles?: CampaignStyleSpec[];
  frameworks?: CampaignFrameworkSpec[];
  num_reels?: number;
  num_posts?: number;
  num_carousels?: number;
}
