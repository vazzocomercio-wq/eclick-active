/**
 * Helper pra chamar a API REST do **SaaS** (eclick-backend) a partir do
 * Active. Usado quando o calendário precisa exibir info de produtos /
 * conteúdo social / campanhas que vivem no schema `public` do SaaS.
 *
 * Convenção: `NEXT_PUBLIC_SAAS_API_URL` aponta pro SaaS (ex:
 * `https://api.saas.eclick.com.br`). O Supabase é compartilhado entre
 * os dois projetos, então o token Supabase do usuário do Active é
 * aceito pelo SaaS.
 *
 * Falhas são silenciosas — quem chama deve degradar UI (ex: badge
 * "vínculo quebrado") sem derrubar a tela.
 */

import { createClient } from '@/lib/supabase/client';

const SAAS_API_URL =
  process.env.NEXT_PUBLIC_SAAS_API_URL ?? '';

export class SaasApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'SaasApiError';
    this.status = status;
  }
}

/** True quando NEXT_PUBLIC_SAAS_API_URL está configurado. */
export function isSaasApiConfigured(): boolean {
  return !!SAAS_API_URL;
}

async function authHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const supabase = createClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* sem env Supabase — segue sem auth e SaaS retorna 401 */
  }
  return headers;
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  if (!SAAS_API_URL) {
    throw new SaasApiError(503, 'SaaS API não configurada');
  }
  const url = path.startsWith('http')
    ? path
    : `${SAAS_API_URL.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`;

  const res = await fetch(url, {
    method: 'GET',
    headers: await authHeaders(),
    ...(signal ? { signal } : {}),
  });

  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    const msg =
      typeof body === 'object' && body && 'message' in body
        ? String((body as { message: unknown }).message)
        : `HTTP ${res.status}`;
    throw new SaasApiError(res.status, msg);
  }

  return (await res.json()) as T;
}

// ──────────────────────────────────────────────────────────
// Tipos resumidos do que o SaaS retorna (compatível com S1/S4 quando entregarem)
// ──────────────────────────────────────────────────────────

export interface SaasProduct {
  id: string;
  name: string;
  thumbnail_url?: string | null;
  short_description?: string | null;
  description?: string | null;
  price?: number | null;
  category?: string | null;
}

export interface SaasSocialContent {
  id: string;
  channel: string;
  product_id: string | null;
  status: string;
  scheduled_at: string | null;
  caption_preview?: string | null;
  thumbnail_url?: string | null;
}

export interface SaasAdsCampaign {
  id: string;
  platform: string;
  product_id: string | null;
  status: string;
  name?: string;
  budget?: number;
}

// ──────────────────────────────────────────────────────────
// API
// ──────────────────────────────────────────────────────────

export const saasApi = {
  /** True se o NEXT_PUBLIC_SAAS_API_URL está configurado. */
  configured: isSaasApiConfigured,

  /** Autocomplete de produtos pra vincular num evento. */
  searchProducts(
    query: string,
    limit = 10,
    signal?: AbortSignal,
  ): Promise<SaasProduct[]> {
    const qs = new URLSearchParams();
    if (query) qs.set('q', query);
    qs.set('limit', String(limit));
    return get<SaasProduct[]>(`/products?${qs.toString()}`, signal);
  },

  /** Detalhe de 1 produto pra hidratar snapshot ao vincular. */
  getProduct(id: string, signal?: AbortSignal): Promise<SaasProduct> {
    return get<SaasProduct>(`/products/${id}`, signal);
  },

  /** Conteúdo social do produto (S1 do SaaS — disponível em breve). */
  listSocialContentByProduct(
    productId: string,
    signal?: AbortSignal,
  ): Promise<SaasSocialContent[]> {
    return get<SaasSocialContent[]>(
      `/social/content?product_id=${productId}`,
      signal,
    );
  },

  /** Campanhas do produto (S4 do SaaS — disponível em breve). */
  listAdsCampaignsByProduct(
    productId: string,
    signal?: AbortSignal,
  ): Promise<SaasAdsCampaign[]> {
    return get<SaasAdsCampaign[]>(
      `/ads/campaigns?product_id=${productId}`,
      signal,
    );
  },
};
