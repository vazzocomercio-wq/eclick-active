import { api } from './client';

// ──────────────────────────────────────────────────────────
// Tipos espelhados do backend (apps/api/src/modules/whatsapp-commerce)
// ──────────────────────────────────────────────────────────

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type OrderPaymentStatus =
  | 'pending'
  | 'paid'
  | 'failed'
  | 'refunded'
  | 'cancelled';

export type ShippingStatus =
  | 'pending'
  | 'processing'
  | 'shipped'
  | 'in_transit'
  | 'delivered'
  | 'returned';

export interface WhatsAppOrderItem {
  product_id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  subtotal: number;
  thumbnail_url: string | null;
}

export interface WhatsAppOrder {
  id: string;
  org_id: string;
  contact_id: string;
  conversation_id: string | null;
  cart_id: string | null;
  order_number: number;
  display_number: string;
  items: WhatsAppOrderItem[];
  subtotal: number;
  discount_total: number;
  shipping_cost: number;
  total: number;
  coupon_code: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  shipping_address: Record<string, unknown>;
  payment_method: string | null;
  payment_link: string | null;
  payment_status: OrderPaymentStatus;
  paid_at: string | null;
  shipping_status: ShippingStatus;
  tracking_code: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  status: OrderStatus;
  internal_notes: string | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
}

export type OrderEventActor =
  | 'system'
  | 'automation'
  | 'agent'
  | 'ai'
  | 'customer'
  | 'webhook';

export interface WhatsAppOrderEvent {
  id: string;
  org_id: string;
  order_id: string;
  event_type: string;
  description: string | null;
  actor_type: OrderEventActor;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

// ──────────────────────────────────────────────────────────
// API client
// ──────────────────────────────────────────────────────────

export const whatsappOrdersApi = {
  list(filters: {
    status?: OrderStatus;
    payment_status?: OrderPaymentStatus;
    contact_id?: string;
  } = {}): Promise<WhatsAppOrder[]> {
    const qs = new URLSearchParams();
    if (filters.status) qs.set('status', filters.status);
    if (filters.payment_status) qs.set('payment_status', filters.payment_status);
    if (filters.contact_id) qs.set('contact_id', filters.contact_id);
    const tail = qs.toString();
    return api.get<WhatsAppOrder[]>(
      `/whatsapp-commerce/orders${tail ? `?${tail}` : ''}`,
    );
  },
  get(id: string): Promise<WhatsAppOrder> {
    return api.get<WhatsAppOrder>(`/whatsapp-commerce/orders/${id}`);
  },
  ship(
    id: string,
    args: { tracking_code: string; tracking_url?: string; carrier?: string },
  ): Promise<WhatsAppOrder> {
    return api.post<WhatsAppOrder>(
      `/whatsapp-commerce/orders/${id}/ship`,
      args,
    );
  },
  markPaid(id: string, payment_id?: string): Promise<WhatsAppOrder> {
    return api.post<WhatsAppOrder>(
      `/whatsapp-commerce/orders/${id}/mark-paid`,
      { payment_id },
    );
  },
  markDelivered(id: string): Promise<WhatsAppOrder> {
    return api.post<WhatsAppOrder>(
      `/whatsapp-commerce/orders/${id}/deliver`,
      {},
    );
  },
  cancel(id: string, reason?: string): Promise<WhatsAppOrder> {
    return api.post<WhatsAppOrder>(
      `/whatsapp-commerce/orders/${id}/cancel`,
      { reason },
    );
  },

  // Timeline (B6)
  listEvents(id: string, limit = 100): Promise<WhatsAppOrderEvent[]> {
    return api.get<WhatsAppOrderEvent[]>(
      `/whatsapp-commerce/orders/${id}/events?limit=${limit}`,
    );
  },
  addEvent(
    id: string,
    args: {
      event_type: string;
      description?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<WhatsAppOrderEvent> {
    return api.post<WhatsAppOrderEvent>(
      `/whatsapp-commerce/orders/${id}/events`,
      args,
    );
  },
};

// ──────────────────────────────────────────────────────────
// Catalog — usado no picker "Mandar produto" da Inbox.
// Endpoints reaproveitam o bridge cross-schema do whatsapp-commerce.
// ──────────────────────────────────────────────────────────

export interface CatalogProduct {
  product_id: string;
  name: string;
  sku: string | null;
  brand: string | null;
  category: string | null;
  short_description: string | null;
  price: number;
  stock: number;
  photo_urls: string[] | null;
  thumbnail_url: string | null;
  in_stock: boolean;
  ml_permalink: string | null;
  landing_page_slug: string | null;
}

export const catalogApi = {
  list(args: { q?: string; limit?: number } = {}): Promise<CatalogProduct[]> {
    const params = new URLSearchParams();
    if (args.q)     params.set('q', args.q);
    if (args.limit) params.set('limit', String(args.limit));
    const qs = params.toString();
    return api.get<CatalogProduct[]>(`/catalog/products${qs ? `?${qs}` : ''}`);
  },
  featured(limit = 10): Promise<CatalogProduct[]> {
    return api.get<CatalogProduct[]>(`/catalog/products/featured?limit=${limit}`);
  },
  getOne(id: string): Promise<CatalogProduct> {
    return api.get<CatalogProduct>(`/catalog/products/${id}`);
  },
};
