import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  SaasOrder,
  SaasProduct,
  SaasOrderStats,
  BridgeStatus,
} from './bridge.types';

/**
 * Bridge SaaS → Active. 100% leitura, com:
 *   - Cache (`hasSaasIntegration` 5min, `getOrdersByContact` 1min)
 *   - Circuit breaker silencioso: erro → marca org como "sem SaaS" 5min,
 *     evita martelar Supabase quando bridge offline.
 *   - Toda função do service entra por `hasSaasIntegration` — se falso,
 *     retorna fallback vazio (`[]` / `null` / `0`) sem lançar.
 *   - Logs `warn`, nunca `error` — bridge offline é estado esperado.
 *
 * Migration: `supabase/migrations/052_bridge_saas_active.sql`.
 * Schema do client supabase-js já é `active` (config global em
 * SupabaseService) — `.from('v_saas_orders')` e `.rpc('xxx')` resolvem
 * automaticamente em `active.v_saas_orders` / `active.xxx`.
 */

const HAS_SAAS_TTL_MS = 5 * 60 * 1000; // 5min
const ORDERS_CACHE_TTL_MS = 60 * 1000; // 1min

@Injectable()
export class BridgeService {
  private readonly log = new Logger(BridgeService.name);
  private readonly hasSaasCache = new Map<
    string,
    { value: boolean; until: number }
  >();
  private readonly ordersCache = new Map<
    string,
    { value: SaasOrder[]; until: number }
  >();
  /** Circuit breaker: se uma chamada falhar, marca a org como "sem SaaS" por 5min. */
  private readonly brokenOrgs = new Map<string, number>();

  constructor(private readonly supabase: SupabaseService) {}

  private isBroken(orgId: string): boolean {
    const until = this.brokenOrgs.get(orgId);
    if (!until) return false;
    if (Date.now() > until) {
      this.brokenOrgs.delete(orgId);
      return false;
    }
    return true;
  }

  private breakOrg(orgId: string, err: unknown) {
    this.brokenOrgs.set(orgId, Date.now() + HAS_SAAS_TTL_MS);
    this.log.warn(
      `bridge offline para org ${orgId} por ${HAS_SAAS_TTL_MS}ms: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  /** True se a org tem dados no SaaS. Cache 5min + circuit breaker. */
  async hasSaasIntegration(orgId: string): Promise<boolean> {
    if (this.isBroken(orgId)) return false;

    const cached = this.hasSaasCache.get(orgId);
    if (cached && cached.until > Date.now()) return cached.value;

    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'has_saas_integration',
        { p_org_id: orgId },
      );
      if (error) throw error;
      const value = !!data;
      this.hasSaasCache.set(orgId, {
        value,
        until: Date.now() + HAS_SAAS_TTL_MS,
      });
      return value;
    } catch (err) {
      this.breakOrg(orgId, err);
      return false;
    }
  }

  /** Busca pedidos por phone/email/nickname do contato. Vazio se sem SaaS ou erro. */
  async getOrdersByContact(
    orgId: string,
    opts: {
      phone?: string | null;
      email?: string | null;
      nickname?: string | null;
      limit?: number;
    },
  ): Promise<SaasOrder[]> {
    if (!(await this.hasSaasIntegration(orgId))) return [];

    const cacheKey = `${orgId}:${opts.phone ?? ''}:${opts.email ?? ''}:${
      opts.nickname ?? ''
    }`;
    const cached = this.ordersCache.get(cacheKey);
    if (cached && cached.until > Date.now()) return cached.value;

    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'get_saas_orders_by_contact',
        {
          p_org_id: orgId,
          p_phone: opts.phone ?? null,
          p_email: opts.email ?? null,
          p_buyer_nickname: opts.nickname ?? null,
          p_limit: opts.limit ?? 20,
        },
      );
      if (error) throw error;
      const value = (data ?? []) as SaasOrder[];
      this.ordersCache.set(cacheKey, {
        value,
        until: Date.now() + ORDERS_CACHE_TTL_MS,
      });
      return value;
    } catch (err) {
      this.log.warn(`getOrdersByContact falhou para ${orgId}: ${String(err)}`);
      return [];
    }
  }

  /** Busca um pedido específico por marketplace_order_id, tracking ou id. */
  async getOrderByQuery(
    orgId: string,
    query: string,
  ): Promise<SaasOrder | null> {
    if (!(await this.hasSaasIntegration(orgId))) return null;
    try {
      const { data, error } = await this.supabase.adminClient
        .from('v_saas_orders')
        .select('*')
        .eq('organization_id', orgId)
        .or(
          `marketplace_order_id.eq.${query},shipping_tracking_number.eq.${query},id.eq.${query}`,
        )
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as SaasOrder | null) ?? null;
    } catch (err) {
      this.log.warn(`getOrderByQuery falhou: ${String(err)}`);
      return null;
    }
  }

  /** Resolve a org do SaaS a partir da org do Active.
   *  `active.organizations.saas_org_id` mapeia Active→SaaS. Quando null
   *  (instância única / mesma org id), cai pro próprio orgId. Cache leve. */
  private readonly saasOrgCache = new Map<string, { value: string | null; until: number }>();
  private async resolveSaasOrgId(activeOrgId: string): Promise<string | null> {
    const cached = this.saasOrgCache.get(activeOrgId);
    if (cached && cached.until > Date.now()) return cached.value;
    try {
      const { data, error } = await this.supabase.adminClient
        .from('organizations')
        .select('saas_org_id')
        .eq('id', activeOrgId)
        .maybeSingle();
      if (error) throw error;
      const value =
        (data as { saas_org_id?: string | null } | null)?.saas_org_id ?? activeOrgId;
      this.saasOrgCache.set(activeOrgId, { value, until: Date.now() + HAS_SAAS_TTL_MS });
      return value;
    } catch (err) {
      this.log.warn(`resolveSaasOrgId falhou para ${activeOrgId}: ${String(err)}`);
      return activeOrgId;
    }
  }

  /** Lista produtos do catálogo do SaaS (pra seletor no Social AI Studio).
   *  Resolve a org Active→SaaS, filtra por thumbnail presente, busca por título. */
  async listProducts(
    activeOrgId: string,
    opts: { search?: string; limit?: number } = {},
  ): Promise<SaasProduct[]> {
    const saasOrgId = await this.resolveSaasOrgId(activeOrgId);
    if (!saasOrgId) return [];
    if (!(await this.hasSaasIntegration(saasOrgId))) return [];
    try {
      let q = this.supabase.adminClient
        .from('v_saas_products')
        .select(
          'id,organization_id,ml_listing_id,title,sku,price,cost,stock_quantity,category,thumbnail_url,status,marketplace,margin_percent,metadata,created_at,updated_at,photos,description',
        )
        .eq('organization_id', saasOrgId)
        .not('thumbnail_url', 'is', null)
        .order('updated_at', { ascending: false, nullsFirst: false })
        .limit(Math.min(opts.limit ?? 60, 200));
      if (opts.search?.trim()) {
        q = q.ilike('title', `%${opts.search.trim()}%`);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SaasProduct[];
    } catch (err) {
      this.log.warn(`listProducts falhou para ${activeOrgId}: ${String(err)}`);
      return [];
    }
  }

  // ── Ponte Canva (proxy HTTP pro SaaS) ──────────────────────────────────
  //
  // O token Canva + lógica de export (OAuth refresh, job polling) vivem no
  // SaaS (fonte única — refresh_token rotation não pode ter 2 donos). O Active
  // só proxia via `/internal/canva/*` autenticado por X-Internal-Key. O web
  // chama o Active normal (JWT) → secret nunca toca o browser.

  private saasInternalConfig(): { baseUrl: string; key: string } | null {
    const baseUrl = (process.env.SAAS_API_URL ?? '').replace(/\/+$/, '');
    const key = process.env.SAAS_INTERNAL_KEY ?? process.env.INTERNAL_API_KEY;
    if (!baseUrl || !key) {
      this.log.warn('ponte Canva: SAAS_API_URL/SAAS_INTERNAL_KEY ausentes');
      return null;
    }
    return { baseUrl, key };
  }

  /** Lista designs do Canva da org (via SaaS). Vazio se sem config/erro. */
  async listCanvaDesigns(
    activeOrgId: string,
    q?: string,
  ): Promise<Array<{ id: string; title: string; thumbnailUrl: string | null }>> {
    const cfg = this.saasInternalConfig();
    if (!cfg) return [];
    const saasOrgId = await this.resolveSaasOrgId(activeOrgId);
    if (!saasOrgId) return [];
    try {
      const url = new URL(`${cfg.baseUrl}/internal/canva/designs`);
      url.searchParams.set('org_id', saasOrgId);
      if (q?.trim()) url.searchParams.set('q', q.trim());
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'X-Internal-Key': cfg.key },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        this.log.warn(`listCanvaDesigns SaaS ${res.status}`);
        return [];
      }
      const json = (await res.json()) as {
        designs?: Array<{ id: string; title: string; thumbnailUrl: string | null }>;
      };
      return json.designs ?? [];
    } catch (err) {
      this.log.warn(`listCanvaDesigns falhou para ${activeOrgId}: ${String(err)}`);
      return [];
    }
  }

  /** Exporta um design do Canva como imagem https estável (via SaaS). */
  async exportCanvaDesign(
    activeOrgId: string,
    designId: string,
  ): Promise<{ url: string } | null> {
    const cfg = this.saasInternalConfig();
    if (!cfg) return null;
    const saasOrgId = await this.resolveSaasOrgId(activeOrgId);
    if (!saasOrgId) return null;
    try {
      const res = await fetch(`${cfg.baseUrl}/internal/canva/export`, {
        method: 'POST',
        headers: { 'X-Internal-Key': cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: saasOrgId, design_id: designId }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        this.log.warn(`exportCanvaDesign SaaS ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { url?: string };
      return json.url ? { url: json.url } : null;
    } catch (err) {
      this.log.warn(`exportCanvaDesign falhou para ${activeOrgId}: ${String(err)}`);
      return null;
    }
  }

  // ── Ponte de vídeo / Reel (proxy HTTP pro pipeline do SaaS) ────────────
  //
  // O motor de vídeo (Kling/Veo/Sora, jobs assíncronos) vive no SaaS. O Active
  // só dispara e faz poll via `/internal/creative/social-video`. Mesma config
  // (SAAS_API_URL + SAAS_INTERNAL_KEY) da ponte Canva.

  async startSocialVideo(
    activeOrgId: string,
    dto: {
      catalog_product_id?: string;
      product_title?: string;
      product_photo_url: string;
      category?: string;
      mode: 'product_photo' | 'ai_scene';
      prompt: string;
      scene_prompt?: string;
      aspect_ratio?: '1:1' | '16:9' | '9:16';
      duration_seconds?: number;
      model_name?: string;
      camera_motion?: string;
      max_cost_usd?: number;
    },
  ): Promise<{ job_id: string } | null> {
    const cfg = this.saasInternalConfig();
    if (!cfg) return null;
    const saasOrgId = await this.resolveSaasOrgId(activeOrgId);
    if (!saasOrgId) return null;
    try {
      const res = await fetch(`${cfg.baseUrl}/internal/creative/social-video`, {
        method: 'POST',
        headers: { 'X-Internal-Key': cfg.key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ org_id: saasOrgId, ...dto }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        this.log.warn(`startSocialVideo SaaS ${res.status}`);
        return null;
      }
      const json = (await res.json()) as { job_id?: string };
      return json.job_id ? { job_id: json.job_id } : null;
    } catch (err) {
      this.log.warn(`startSocialVideo falhou para ${activeOrgId}: ${String(err)}`);
      return null;
    }
  }

  async getSocialVideo(
    activeOrgId: string,
    jobId: string,
  ): Promise<{
    status: string;
    public_url: string | null;
    preview_url: string | null;
    error: string | null;
  } | null> {
    const cfg = this.saasInternalConfig();
    if (!cfg) return null;
    const saasOrgId = await this.resolveSaasOrgId(activeOrgId);
    if (!saasOrgId) return null;
    try {
      const url = new URL(`${cfg.baseUrl}/internal/creative/social-video/${encodeURIComponent(jobId)}`);
      url.searchParams.set('org_id', saasOrgId);
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'X-Internal-Key': cfg.key },
        signal: AbortSignal.timeout(25_000),
      });
      if (!res.ok) {
        this.log.warn(`getSocialVideo SaaS ${res.status}`);
        return null;
      }
      return (await res.json()) as {
        status: string;
        public_url: string | null;
        preview_url: string | null;
        error: string | null;
      };
    } catch (err) {
      this.log.warn(`getSocialVideo falhou para ${activeOrgId}: ${String(err)}`);
      return null;
    }
  }

  /** Produto por SKU ou ml_listing_id. */
  async getProduct(
    orgId: string,
    opts: { sku?: string; mlListingId?: string },
  ): Promise<SaasProduct | null> {
    if (!(await this.hasSaasIntegration(orgId))) return null;
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'get_saas_product',
        {
          p_org_id: orgId,
          p_sku: opts.sku ?? null,
          p_ml_listing_id: opts.mlListingId ?? null,
        },
      );
      if (error) throw error;
      const rows = (data ?? []) as SaasProduct[];
      return rows[0] ?? null;
    } catch (err) {
      this.log.warn(`getProduct falhou: ${String(err)}`);
      return null;
    }
  }

  /** Últimos pedidos da org (dashboard). */
  async getRecentOrders(orgId: string, limit = 10): Promise<SaasOrder[]> {
    if (!(await this.hasSaasIntegration(orgId))) return [];
    try {
      const { data, error } = await this.supabase.adminClient
        .from('v_saas_orders')
        .select('*')
        .eq('organization_id', orgId)
        .order('date_created', { ascending: false, nullsFirst: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as SaasOrder[];
    } catch (err) {
      this.log.warn(`getRecentOrders falhou: ${String(err)}`);
      return [];
    }
  }

  /** Estatísticas agregadas (total, atrasados, entregues, revenue). */
  async getOrderStats(orgId: string, sinceDays = 30): Promise<SaasOrderStats> {
    const empty: SaasOrderStats = {
      total_orders: 0,
      delayed_orders: 0,
      delivered_orders: 0,
      total_revenue: 0,
    };
    if (!(await this.hasSaasIntegration(orgId))) return empty;
    try {
      const since = new Date(
        Date.now() - sinceDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      const { data, error } = await this.supabase.adminClient.rpc(
        'get_saas_order_stats',
        { p_org_id: orgId, p_since: since },
      );
      if (error) throw error;
      const rows = (data ?? []) as SaasOrderStats[];
      return rows[0] ?? empty;
    } catch (err) {
      this.log.warn(`getOrderStats falhou: ${String(err)}`);
      return empty;
    }
  }

  /** Status pra UI: has_saas + cache_ttl. */
  async getStatus(orgId: string): Promise<BridgeStatus> {
    return {
      has_saas: await this.hasSaasIntegration(orgId),
      checked_at: new Date().toISOString(),
      cache_ttl_ms: HAS_SAAS_TTL_MS,
    };
  }

  /** Invalida caches da org (chamar de webhooks do SaaS quando rolar mudança). */
  invalidate(orgId: string) {
    this.hasSaasCache.delete(orgId);
    this.brokenOrgs.delete(orgId);
    for (const key of this.ordersCache.keys()) {
      if (key.startsWith(`${orgId}:`)) this.ordersCache.delete(key);
    }
  }
}
