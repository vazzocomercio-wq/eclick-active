import { api } from './client';

/**
 * Cliente da bridge cross-schema (public SaaS → active CRM).
 *
 * Backend: `apps/api/src/modules/bridge/`
 * Migration: `supabase/migrations/052_bridge_saas_active.sql`
 *
 * Toda chamada tem fallback silencioso no backend (vazio em vez de erro)
 * quando o SaaS não está disponível pra org — caller pode confiar que
 * arrays/null/false sempre vêm de volta sem necessidade de try/catch.
 */

export interface SaasOrder {
  id: string;
  marketplace: string | null;
  marketplace_order_id: string | null;
  status: string | null;
  buyer_nickname: string | null;
  buyer_phone: string | null;
  buyer_email: string | null;
  total_amount: number | null;
  shipping_status: string | null;
  shipping_tracking_number: string | null;
  shipping_estimated_delivery: string | null;
  date_created: string | null;
  items: unknown;
}

export interface SaasProduct {
  id: string;
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
}

export interface CanvaDesign {
  id: string;
  title: string;
  thumbnailUrl: string | null;
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

export interface OrdersByContactParams {
  phone?: string;
  email?: string;
  nickname?: string;
  limit?: number;
}

export const bridgeApi = {
  status: (signal?: AbortSignal) =>
    api.get<BridgeStatus>('/bridge/status', { signal }),

  ordersByContact: (params: OrdersByContactParams, signal?: AbortSignal) =>
    api.get<SaasOrder[]>('/bridge/orders', {
      query: {
        phone: params.phone,
        email: params.email,
        nickname: params.nickname,
        limit: params.limit,
      },
      signal,
    }),

  recent: (limit = 10, signal?: AbortSignal) =>
    api.get<SaasOrder[]>('/bridge/orders/recent', {
      query: { limit },
      signal,
    }),

  stats: (days = 30, signal?: AbortSignal) =>
    api.get<SaasOrderStats>('/bridge/orders/stats', {
      query: { days },
      signal,
    }),

  searchOrder: (q: string, signal?: AbortSignal) =>
    api.get<SaasOrder | null>('/bridge/orders/search', {
      query: { q },
      signal,
    }),

  productBySku: (sku: string, signal?: AbortSignal) =>
    api.get<SaasProduct | null>(`/bridge/products/${encodeURIComponent(sku)}`, {
      signal,
    }),

  /** Lista produtos do catálogo do SaaS (seletor do Social AI Studio). */
  listProducts: (
    params: { search?: string; limit?: number } = {},
    signal?: AbortSignal,
  ) =>
    api.get<SaasProduct[]>('/bridge/products', {
      query: { search: params.search, limit: params.limit },
      signal,
    }),

  /** Lista designs do Canva da org (pra usar como imagem do post). */
  listCanvaDesigns: (q?: string, signal?: AbortSignal) =>
    api.get<{ designs: CanvaDesign[] }>('/bridge/canva/designs', {
      query: { q },
      signal,
    }),

  /** Exporta um design do Canva como imagem https estável. */
  exportCanvaDesign: (designId: string, signal?: AbortSignal) =>
    api.post<{ url: string | null }>(
      '/bridge/canva/export',
      { design_id: designId },
      { signal },
    ),
};
