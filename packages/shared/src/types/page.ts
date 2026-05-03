import type { ISODateString, UUID } from './common';

// ────────────────────────────────────────────────────────────
// Page
// ────────────────────────────────────────────────────────────

export type PageStatus = 'draft' | 'published' | 'paused' | 'archived';

export type PageType =
  | 'landing'
  | 'store'
  | 'booking'
  | 'link_in_bio'
  | 'sales_page'
  | 'thank_you';

/**
 * Tipos de bloco — cada um tem shape específico em PageBlockContent.
 * Categorias (organizam UI do "+ Adicionar bloco"):
 *  - Layout: hero, hero_video, section, two_columns, three_columns
 *  - Conteúdo: heading, text, image, video, gallery, benefits, features,
 *              stats, testimonials, faq, about, team, timeline, comparison,
 *              countdown, banner, divider, spacer, custom_html
 *  - Conversão: cta, form, whatsapp_button, booking
 *  - Loja: product_grid, product_featured, product_carousel, cart, checkout, pricing_table
 *  - Estrutura: navbar, footer, floating_cta
 */
export type BlockType =
  // Layout
  | 'hero'
  | 'hero_video'
  | 'section'
  | 'two_columns'
  | 'three_columns'
  // Conteúdo
  | 'heading'
  | 'text'
  | 'image'
  | 'video'
  | 'gallery'
  | 'benefits'
  | 'features'
  | 'stats'
  | 'testimonials'
  | 'faq'
  | 'about'
  | 'team'
  | 'timeline'
  | 'comparison'
  | 'countdown'
  | 'banner'
  | 'divider'
  | 'spacer'
  | 'custom_html'
  // Conversão
  | 'cta'
  | 'form'
  | 'whatsapp_button'
  | 'booking'
  // Loja
  | 'product_grid'
  | 'product_featured'
  | 'product_carousel'
  | 'cart'
  | 'checkout'
  | 'pricing_table'
  // Estrutura
  | 'navbar'
  | 'footer'
  | 'floating_cta';

export interface BlockSettings {
  background?: string;
  /** padding vertical: 'sm' | 'md' | 'lg' | 'xl' */
  padding?: 'sm' | 'md' | 'lg' | 'xl';
  /** largura máxima do conteúdo: 'sm' | 'md' | 'lg' | 'full' */
  max_width?: 'sm' | 'md' | 'lg' | 'full';
  visibility?: 'all' | 'desktop' | 'mobile';
  animation?: 'none' | 'fade_in' | 'slide_up' | 'slide_left';
  /** ID âncora pra links internos (#beneficios) */
  anchor_id?: string;
}

/**
 * Bloco genérico. content é um Record<string, unknown> com shape específico
 * por type — validação e renderização ficam no page-renderer e nos block-editors.
 */
export interface PageBlock {
  id: string;
  type: BlockType;
  content: Record<string, unknown>;
  settings: BlockSettings;
  position: number;
}

export interface PageGlobalStyles {
  primary_color?: string;
  secondary_color?: string;
  accent_color?: string;
  background?: string;
  text_color?: string;
  font_heading?: string;
  font_body?: string;
  /** Border radius global em px (0-24) */
  border_radius?: number;
}

export interface PageSEO {
  title?: string;
  description?: string;
  og_title?: string;
  og_description?: string;
  og_image?: string;
  favicon?: string;
  canonical_url?: string;
  /** Robots: 'index, follow' (default) ou 'noindex' */
  robots?: 'index, follow' | 'noindex' | 'noindex, nofollow';
}

export interface PageSettings {
  /** Scripts externos: GA, Pixel, GTM, etc — injetados no <head> */
  tracking_scripts?: {
    google_analytics_id?: string;
    facebook_pixel_id?: string;
    tiktok_pixel_id?: string;
    google_tag_manager_id?: string;
    custom_head_html?: string;
  };
  /** Redirect URL após form submit dentro da página */
  redirect_after_form?: string;
  /** Botão WhatsApp flutuante global (independente de blocks) */
  whatsapp_floating?: {
    enabled: boolean;
    phone?: string;
    message?: string;
    position?: 'bottom_right' | 'bottom_left';
  };
  /** Configuração de loja (page_type='store') */
  store?: {
    pix_key?: string;
    pix_recipient_name?: string;
    /** Mensagem WhatsApp pós-checkout (placeholders {order_number}, {total}, {customer_name}) */
    whatsapp_after_order?: string;
    /** Telefone admin que recebe notificação de novo pedido */
    admin_phone?: string;
    shipping_fee?: number;
    free_shipping_above?: number;
    /** Métodos de pagamento ativos */
    payment_methods?: ('whatsapp' | 'pix')[];
  };
}

/**
 * Página completa (admin view).
 * Tabela: active.pages
 */
export interface Page {
  id: UUID;
  org_id: UUID;
  name: string;
  slug: string;
  page_type: PageType;
  blocks: PageBlock[];
  global_styles: PageGlobalStyles;
  seo: PageSEO;
  settings: PageSettings;
  status: PageStatus;
  custom_domain: string | null;
  published_html: string | null;
  published_at: ISODateString | null;
  version: number;
  template_id: string | null;
  ai_generated: boolean;
  metadata: Record<string, unknown>;
  visits_count: number;
  orders_count: number;
  conversions_count: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/** Shape público da página — apenas o necessário para renderizar /p/:slug */
export interface PagePublic {
  id: UUID;
  name: string;
  slug: string;
  page_type: PageType;
  blocks: PageBlock[];
  global_styles: PageGlobalStyles;
  seo: PageSEO;
  settings: PageSettings;
}

// ────────────────────────────────────────────────────────────
// PageVisit
// ────────────────────────────────────────────────────────────

export type DeviceType = 'desktop' | 'mobile' | 'tablet';

export interface PageVisit {
  id: UUID;
  page_id: UUID;
  org_id: UUID;
  visitor_id: string | null;
  session_id: string | null;
  source: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  referrer: string | null;
  device: DeviceType | null;
  browser: string | null;
  country: string | null;
  city: string | null;
  duration_seconds: number | null;
  scroll_depth_pct: number | null;
  pages_viewed: number;
  form_submitted: boolean;
  product_viewed: string[] | null;
  cart_created: boolean;
  order_completed: boolean;
  order_value: number | null;
  created_at: ISODateString;
}

// ────────────────────────────────────────────────────────────
// StoreProduct
// ────────────────────────────────────────────────────────────

export interface StoreProductVariant {
  name: string;
  options: string[];
}

export interface StoreProduct {
  id: UUID;
  page_id: UUID;
  org_id: UUID;
  catalog_product_id: UUID | null;
  name: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  currency: string;
  images: string[];
  variants: StoreProductVariant[];
  category: string | null;
  sku: string | null;
  stock_quantity: number | null;
  is_active: boolean;
  position: number;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// ────────────────────────────────────────────────────────────
// StoreOrder
// ────────────────────────────────────────────────────────────

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded';
export type FulfillmentStatus =
  | 'unfulfilled'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled';

export interface OrderItem {
  product_id: UUID;
  name: string;
  price: number;
  quantity: number;
  variant_label?: string;
  image?: string;
  subtotal: number;
}

export interface OrderAddress {
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface StoreOrder {
  id: UUID;
  page_id: UUID;
  org_id: UUID;
  contact_id: UUID | null;
  deal_id: UUID | null;
  order_number: number;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  discount: number;
  total: number;
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  customer_address: OrderAddress | null;
  payment_method: string | null;
  payment_status: PaymentStatus;
  fulfillment_status: FulfillmentStatus;
  notes: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

// ────────────────────────────────────────────────────────────
// AI generation
// ────────────────────────────────────────────────────────────

export interface AiPageGenerationInput {
  description: string;
  page_type: PageType;
  use_catalog_products?: boolean;
  include_form?: boolean;
  include_whatsapp?: boolean;
  /** Forms existentes que podem ser referenciados — ID do form */
  available_form_id?: string;
}

export interface AiPageImprovement {
  block_id?: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'cta' | 'copy' | 'design' | 'social_proof' | 'seo' | 'performance' | 'mobile';
  title: string;
  description: string;
  /** Ação sugerida — pode ser texto livre ou referência a uma operação */
  action?: string;
}

// ────────────────────────────────────────────────────────────
// Public store helpers
// ────────────────────────────────────────────────────────────

export interface CartLineItem {
  product_id: UUID;
  quantity: number;
  variant_label?: string;
}

export interface CreateOrderPayload {
  items: CartLineItem[];
  customer_name: string;
  customer_email?: string;
  customer_phone: string;
  customer_address?: OrderAddress;
  payment_method?: 'whatsapp' | 'pix';
  notes?: string;
  utm_source?: string;
  utm_campaign?: string;
}
