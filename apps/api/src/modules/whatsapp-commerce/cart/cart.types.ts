/**
 * Tipos do carrinho WhatsApp.
 */

export type CartStatus =
  | 'active'
  | 'abandoned'
  | 'recovered'
  | 'converted'
  | 'expired';

export type PaymentStatus = 'pending' | 'sent' | 'paid' | 'failed' | 'refunded';

export interface CartItem {
  product_id: string;
  name: string;
  sku: string | null;
  quantity: number;
  unit_price: number;
  discount_pct: number;
  subtotal: number;
  thumbnail_url: string | null;
  added_at: string;
}

export interface WhatsAppCart {
  id: string;
  org_id: string;
  contact_id: string;
  conversation_id: string | null;
  items: CartItem[];
  subtotal: number;
  discount_total: number;
  shipping_cost: number;
  total: number;
  coupon_code: string | null;
  coupon_discount: number;
  shipping_method: string | null;
  shipping_zip: string | null;
  shipping_estimate_days: number | null;
  status: CartStatus;
  abandoned_at: string | null;
  recovered_at: string | null;
  converted_at: string | null;
  order_id: string | null;
  payment_link: string | null;
  payment_status: PaymentStatus | null;
  last_interaction_at: string;
  interaction_count: number;
  ai_assisted: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface AddItemInput {
  product_id: string;
  name: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  thumbnail_url?: string | null;
}
