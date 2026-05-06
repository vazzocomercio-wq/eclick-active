import type { CartItem } from '../cart/cart.types';

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'processing'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refunded';

export type OrderPaymentMethod =
  | 'pix'
  | 'credit_card'
  | 'boleto'
  | 'link'
  | 'manual';

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

export interface ShippingAddress {
  zip?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  state?: string;
}

export interface WhatsAppOrder {
  id: string;
  org_id: string;
  contact_id: string;
  conversation_id: string | null;
  cart_id: string | null;
  order_number: number;
  display_number: string;
  items: CartItem[];
  subtotal: number;
  discount_total: number;
  shipping_cost: number;
  total: number;
  coupon_code: string | null;
  customer_name: string | null;
  customer_phone: string;
  customer_email: string | null;
  shipping_address: ShippingAddress;
  payment_method: OrderPaymentMethod | null;
  payment_link: string | null;
  payment_status: OrderPaymentStatus;
  payment_id: string | null;
  paid_at: string | null;
  shipping_status: ShippingStatus;
  tracking_code: string | null;
  tracking_url: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  status: OrderStatus;
  internal_notes: string | null;
  customer_notes: string | null;
  saas_order_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface CreateOrderFromCartInput {
  cart_id: string;
  payment_method: OrderPaymentMethod;
  shipping_address?: ShippingAddress;
  customer_notes?: string;
}

export interface PaymentLink {
  url: string | null;
  qr_code?: string;
  pix_copy_paste?: string;
  external_id?: string;
  provider: 'mercado_pago' | 'pix_manual' | 'manual';
}

/**
 * Evento da timeline de um pedido. Inserido por trigger SQL pra
 * mudanças de status + por automation runners pra mensagens.
 */
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
  /** ex: 'status:confirmed', 'payment:paid', 'message:tracking', 'note' */
  event_type: string;
  description: string | null;
  actor_type: OrderEventActor;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
