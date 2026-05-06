/**
 * Tipos do bridge de catálogo SaaS → Active.
 */

export interface CatalogProduct {
  product_id: string;
  saas_organization_id: string;
  name: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  short_description: string | null;
  price: number;
  cost_price: number | null;
  stock: number;
  condition: string | null;
  weight_kg: number | null;
  width_cm: number | null;
  height_cm: number | null;
  length_cm: number | null;
  photo_urls: string[] | null;
  images: unknown;
  gtin: string | null;
  model: string | null;
  differentials: string[];
  bullets: string[];
  technical_sheet: Record<string, unknown>;
  faq: unknown;
  tags: string[];
  seo_keywords: string[];
  target_audience: string | null;
  ai_score: number | null;
  ai_enriched: boolean;
  catalog_status: string | null;
  channel_titles: Record<string, unknown>;
  channel_descriptions: Record<string, unknown>;
  published_channels: string[];
  ml_item_id: string | null;
  ml_permalink: string | null;
  status: string;
  landing_page_enabled: boolean;
  landing_page_slug: string | null;
  in_stock: boolean;
  margin_pct: number | null;
  thumbnail_url: string | null;
}

export interface WhatsAppCatalogConfig {
  id: string;
  org_id: string;
  product_id: string;
  whatsapp_enabled: boolean;
  whatsapp_message: string | null;
  whatsapp_price_override: number | null;
  max_quantity_per_order: number;
  min_quantity_per_order: number;
  allow_negotiation: boolean;
  negotiation_floor_price: number | null;
  negotiation_rules: Record<string, unknown>;
  whatsapp_category: string | null;
  whatsapp_tags: string[];
  featured: boolean;
  sort_order: number;
  times_sent: number;
  times_added_to_cart: number;
  times_purchased: number;
  last_sent_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CatalogListFilters {
  query?: string;
  category?: string;
  min_price?: number;
  max_price?: number;
  in_stock_only?: boolean;
  limit?: number;
}

export interface WhatsAppCommerceSettings {
  id: string;
  org_id: string;
  enabled: boolean;
  ai_seller_enabled: boolean;
  cart_expiry_minutes: number;
  cart_abandon_minutes: number;
  auto_recover_abandoned: boolean;
  recovery_delay_minutes: number;
  payment_providers: unknown;
  default_payment_method: string;
  shipping_config: Record<string, unknown>;
  ai_seller_persona: string;
  ai_seller_rules: Record<string, unknown>;
  notify_on_order: boolean;
  notify_on_payment: boolean;
  notify_email: string | null;
  notify_whatsapp: string | null;
  recovery_coupon_code: string | null;
  recovery_coupon_discount_pct: number | null;
  created_at: string;
  updated_at: string;
}
