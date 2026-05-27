/**
 * Tipos da bridge cross-schema (public SaaS → active CRM).
 * Espelham o shape das views `active.v_saas_*` (M052).
 */

export interface SaasOrder {
  id: string;
  organization_id: string;
  marketplace: string | null;
  marketplace_order_id: string | null;
  status: string | null;
  buyer_nickname: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  buyer_document: string | null;
  total_amount: number | null;
  currency_id: string | null;
  date_created: string | null;
  date_closed: string | null;
  shipping_status: string | null;
  shipping_tracking_number: string | null;
  shipping_carrier: string | null;
  shipping_estimated_delivery: string | null;
  shipping_actual_delivery: string | null;
  payment_status: string | null;
  payment_method: string | null;
  items: unknown;
  tags: string[] | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface SaasProduct {
  id: string;
  organization_id: string;
  ml_listing_id: string | null;
  title: string | null;
  sku: string | null;
  price: number | null;
  cost: number | null;
  stock_quantity: number | null;
  category: string | null;
  thumbnail_url: string | null;
  status: string | null;
  marketplace: string | null;
  margin_percent: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  /** Todas as fotos do produto (https). Pra escolher a base do reel. */
  photos?: string[] | null;
  /** Descrição do produto — enriquece o roteiro do reel. */
  description?: string | null;
}

export interface SaasOrderStats {
  total_orders: number;
  delayed_orders: number;
  delivered_orders: number;
  total_revenue: number;
}

export interface BridgeStatus {
  has_saas: boolean;
  checked_at: string;
  cache_ttl_ms: number;
}

/** Sinais comerciais por produto (Social Commerce AI Fase 2). */
export type DemandTrend = 'rising' | 'stable' | 'unknown';
export interface CommercialSignal {
  product_id: string;
  margin_pct: number | null;
  stock: number;
  is_overstock: boolean;
  days_since_movement: number | null;
  demand_trend: DemandTrend;
}

export interface CampaignCandidate extends CommercialSignal {
  product_name: string;
  product_photo_url: string | null;
  product_photos: string[];
  product_description: string | null;
  category: string | null;
  score: number;
}

/** Resumo orgânico coletado no SaaS (analytics_social_posts) — Social Intelligence. */
export interface OrganicSummary {
  totals: {
    posts: number;
    reach: number;
    views: number;
    engagement: number;
    avg_engagement_rate: number;
    followers: number;
    profile_views: number;
  };
  by_format: Array<{ format: string; posts: number; avg_reach: number; avg_engagement_rate: number }>;
  heatmap: Array<{ dow: number; hour: number; posts: number; reach: number }>;
  top_posts: Array<{
    permalink: string | null;
    caption: string;
    type: string | null;
    thumbnail_url: string | null;
    reach: number;
    views: number;
    engagement_rate: number;
  }>;
  trend: Array<{ date: string; reach: number; views: number }>;
  best_format: string | null;
  best_hour: number | null;
}

/** Drill-down por post (TR-A) — dados individuais coletados no SaaS. */
export interface OrganicPostMetrics {
  reach: number;
  views: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  impressions: number;
  total_interactions: number;
  engagement_rate: number;
}
export interface OrganicPostItem {
  id: string;
  network: string;
  account_external_id: string;
  external_post_id: string;
  media_type: string | null;
  media_product_type: string | null;
  permalink: string | null;
  caption: string;
  thumbnail_url: string | null;
  media_url: string | null;
  published_at: string | null;
  source: string;
  insights_available: boolean;
  metrics: OrganicPostMetrics;
  score: number;
}
export interface OrganicPostsPage {
  posts: OrganicPostItem[];
  total: number;
}
export interface OrganicPostDailyPoint {
  date: string;
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  video_views: number;
  total_interactions: number;
  engagement_rate: number;
}
export interface OrganicPostDetail {
  post: OrganicPostItem;
  daily: OrganicPostDailyPoint[];
  benchmark: {
    format: string;
    median_reach: number;
    median_engagement_rate: number;
    sample: number;
  } | null;
}
export interface OrganicPostsFilters {
  format?: string;
  network?: string;
  account?: string;
  search?: string;
  sort?: 'reach' | 'engagement' | 'recent' | 'score';
  limit?: number;
  offset?: number;
}
