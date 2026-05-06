import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import type {
  CatalogProduct,
  WhatsAppCatalogConfig,
  CatalogListFilters,
} from './catalog.types';

/**
 * Service de catálogo via bridge SaaS↔Active. Lê da view
 * `active.v_catalog_products` (que vem de `public.products`) através
 * das RPCs `catalog_list_products` / `catalog_get_product` que fazem
 * JOIN com `active.saas_org_mapping`.
 *
 * Pra orgs sem SaaS associado, retorna vazio (sem erro).
 */
@Injectable()
export class CatalogService {
  private readonly log = new Logger(CatalogService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async list(
    orgId: string,
    filters: CatalogListFilters = {},
  ): Promise<CatalogProduct[]> {
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'catalog_list_products',
        {
          p_active_org_id: orgId,
          p_query: filters.query ?? null,
          p_category: filters.category ?? null,
          p_min_price: filters.min_price ?? null,
          p_max_price: filters.max_price ?? null,
          p_in_stock_only: filters.in_stock_only ?? true,
          p_limit: filters.limit ?? 20,
        },
      );
      if (error) throw error;
      return (data ?? []) as CatalogProduct[];
    } catch (err) {
      this.log.warn(`catalog list falhou (org=${orgId}): ${String(err)}`);
      return [];
    }
  }

  async getById(orgId: string, productId: string): Promise<CatalogProduct | null> {
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'catalog_get_product',
        { p_active_org_id: orgId, p_product_id: productId },
      );
      if (error) throw error;
      const rows = (data ?? []) as CatalogProduct[];
      return rows[0] ?? null;
    } catch (err) {
      this.log.warn(`catalog get ${productId} falhou: ${String(err)}`);
      return null;
    }
  }

  async featured(orgId: string, limit = 10): Promise<CatalogProduct[]> {
    // Pega configs featured + faz lookup nos produtos
    const { data: configs } = await this.supabase.adminClient
      .from('whatsapp_catalog_config')
      .select('product_id')
      .eq('org_id', orgId)
      .eq('featured', true)
      .eq('whatsapp_enabled', true)
      .order('sort_order', { ascending: true })
      .limit(limit);

    const ids = ((configs ?? []) as Array<{ product_id: string }>).map(
      (c) => c.product_id,
    );
    if (ids.length === 0) return [];

    const products: CatalogProduct[] = [];
    for (const id of ids) {
      const p = await this.getById(orgId, id);
      if (p) products.push(p);
    }
    return products;
  }

  // ─── WhatsApp config por produto ─────────────────

  async getConfig(
    orgId: string,
    productId: string,
  ): Promise<WhatsAppCatalogConfig | null> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_catalog_config')
      .select('*')
      .eq('org_id', orgId)
      .eq('product_id', productId)
      .maybeSingle();
    return (data as WhatsAppCatalogConfig | null) ?? null;
  }

  async upsertConfig(
    orgId: string,
    productId: string,
    patch: Partial<WhatsAppCatalogConfig>,
  ): Promise<WhatsAppCatalogConfig> {
    const { data, error } = await this.supabase.adminClient
      .from('whatsapp_catalog_config')
      .upsert(
        { ...patch, org_id: orgId, product_id: productId },
        { onConflict: 'org_id,product_id' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as WhatsAppCatalogConfig;
  }

  async listConfigs(orgId: string): Promise<WhatsAppCatalogConfig[]> {
    const { data } = await this.supabase.adminClient
      .from('whatsapp_catalog_config')
      .select('*')
      .eq('org_id', orgId)
      .order('sort_order', { ascending: true });
    return (data ?? []) as WhatsAppCatalogConfig[];
  }

  /** Incrementa métricas de uso (best-effort). */
  async incrementMetric(
    orgId: string,
    productId: string,
    metric: 'sent' | 'added_to_cart' | 'purchased',
  ): Promise<void> {
    try {
      const config = await this.getConfig(orgId, productId);
      if (!config) {
        // Cria config default
        await this.upsertConfig(orgId, productId, { whatsapp_enabled: true });
      }
      const column =
        metric === 'sent'
          ? 'times_sent'
          : metric === 'added_to_cart'
            ? 'times_added_to_cart'
            : 'times_purchased';
      const current =
        (config?.[column as keyof WhatsAppCatalogConfig] as number | undefined) ?? 0;
      await this.supabase.adminClient
        .from('whatsapp_catalog_config')
        .update({
          [column]: current + 1,
          ...(metric === 'sent' ? { last_sent_at: new Date().toISOString() } : {}),
        })
        .eq('org_id', orgId)
        .eq('product_id', productId);
    } catch (err) {
      this.log.warn(`incrementMetric falhou: ${String(err)}`);
    }
  }
}
