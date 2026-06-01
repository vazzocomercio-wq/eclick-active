import { Injectable, Logger } from '@nestjs/common';
import type {
  AdAccount,
  AdProvider,
  ActionResult,
  DateRange,
  EntityStatus,
  NormalizedEntity,
  NormalizedInsight,
  ProviderCapabilities,
  ProviderDecision,
} from '../contracts/ad-provider';

/**
 * Adaptador TikTok Ads — GMV Max (4º provider). É o "Ads do TikTok Shop": as
 * campanhas que vendem os produtos da loja (Product/LIVE GMV Max). NÃO é mídia
 * social/branding — são anúncios de venda, lidos pela Marketing API do TikTok
 * (business-api.tiktok.com), a ÚNICA porta programática do GMV Max (a API do
 * TikTok Shop não expõe anúncios).
 *
 * Arquitetura "direto no Active" (igual Meta/Google): esta classe implementa
 * AdProvider e se registra no dispatcher; o MOTOR (ingest, dossiê, análise,
 * outcome, KB, fila) NÃO muda em nada. A campanha vira `catalog_sales`
 * (objetivo de venda) e o motor julga por ROAS/ROI contra a margem real da org.
 *
 * ⚠️ SCAFFOLD (app de Marketing API ainda em aprovação no TikTok). Credenciais
 * vêm de env enquanto não há OAuth self-service:
 *   - TIKTOK_ADS_ACCESS_TOKEN  → token longo-vivo da Marketing API
 *   - TIKTOK_ADS_STORE_ID      → store_id(s) do TikTok Shop (vírgula), p/ o GMV Max report
 *   (advertiser_id vem de account.externalAccountId, setado no enroll)
 *
 * Os endpoints/campos exatos do GMV Max (paths, nomes de métricas) são
 * CONFIRMADOS via probe read-only quando o app for aprovado e o token existir —
 * por isso o parsing aqui é DEFENSIVO (aceita nomes alternativos). MVP read-only
 * (GMV Max é automatizado; a alavanca é ROI-alvo/orçamento). applyAction =
 * copiloto até a fase de escrita.
 */
const TT_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

@Injectable()
export class TikTokAdsProvider implements AdProvider {
  readonly platform = 'tiktok' as const;
  private readonly logger = new Logger(TikTokAdsProvider.name);

  capabilities(): ProviderCapabilities {
    return {
      canAdjustBudget: false, // escrita no GMV Max chega numa fase futura
      canPauseEntity: false,
      canAdjustBid: false,
      canReallocateAcrossAdsets: false,
      hasLeadWebhook: false,
      minBudgetChangeStepCents: 100,
    };
  }

  // ── SYNC: campanhas GMV Max ────────────────────────────────
  async syncEntities(account: AdAccount): Promise<NormalizedEntity[]> {
    const token = this.resolveToken();
    if (!token) {
      this.logger.warn('syncEntities: TIKTOK_ADS_ACCESS_TOKEN ausente — TikTok Ads em scaffold');
      return [];
    }
    const advertiserId = account.externalAccountId;
    const storeIds = this.resolveStoreIds();

    const list = await this.getPaged(token, '/gmv_max/campaign/get/', {
      advertiser_id: advertiserId,
      ...(storeIds.length ? { store_ids: storeIds } : {}),
    }).catch((e) => {
      this.logger.warn(`syncEntities GMV Max campaigns falhou: ${msg(e)}`);
      return [] as Array<Record<string, unknown>>;
    });

    return list.map((c) => {
      const budget = num(c.budget ?? c.daily_budget);
      return {
        level: 'campaign' as const,
        externalId: String(c.campaign_id ?? c.gmv_max_campaign_id ?? c.id ?? ''),
        parentExternalId: null,
        name: (c.campaign_name ?? c.name ?? null) as string | null,
        objective: 'catalog_sales', // GMV Max = venda de produto do Shop
        status: ttStatus(String(c.operation_status ?? c.status ?? '')),
        budgetCents: budget != null && Number.isFinite(budget) ? Math.round(budget * 100) : null,
        budgetType: budget != null ? ('daily' as const) : null,
        raw: c as Record<string, unknown>,
      };
    }).filter((e) => e.externalId);
  }

  // ── INGEST: relatório do GMV Max (por campanha × dia) ──────
  async fetchInsights(
    account: AdAccount,
    range: DateRange,
    _entities: NormalizedEntity[],
  ): Promise<NormalizedInsight[]> {
    const token = this.resolveToken();
    if (!token) return [];
    const advertiserId = account.externalAccountId;
    const storeIds = this.resolveStoreIds();
    const start = range.since.toISOString().slice(0, 10);
    const end = range.until.toISOString().slice(0, 10);

    const list = await this.getPaged(token, '/gmv_max/report/get/', {
      advertiser_id: advertiserId,
      ...(storeIds.length ? { store_ids: storeIds } : {}),
      dimensions: ['campaign_id', 'stat_time_day'],
      // Nomes a confirmar no probe; o extrator abaixo tolera variações.
      metrics: ['cost', 'orders', 'gross_revenue', 'net_cost', 'roi'],
      start_date: start,
      end_date: end,
    }).catch((e) => {
      this.logger.warn(`fetchInsights GMV Max report falhou: ${msg(e)}`);
      return [] as Array<Record<string, unknown>>;
    });

    const out: NormalizedInsight[] = [];
    for (const row of list) {
      const dims = (row.dimensions ?? row) as Record<string, unknown>;
      const m = (row.metrics ?? row) as Record<string, unknown>;
      const campaignId = String(dims.campaign_id ?? '');
      const dateRaw = String(dims.stat_time_day ?? dims.date ?? '');
      if (!campaignId || !dateRaw) continue;
      const spend = num(m.cost ?? m.spend ?? m.net_cost) ?? 0;
      const orders = num(m.orders ?? m.order_count ?? m.sku_orders ?? m.conversions) ?? 0;
      const revenue = num(m.gross_revenue ?? m.total_revenue ?? m.net_revenue ?? m.revenue) ?? 0;
      out.push({
        entityExternalId: campaignId,
        level: 'campaign' as const,
        date: dateRaw.slice(0, 10),
        spendCents: Math.round(spend * 100),
        impressions: Math.round(num(m.impressions ?? m.show_cnt) ?? 0),
        clicks: Math.round(num(m.clicks ?? m.click_cnt) ?? 0),
        conversions: orders,
        revenueCents: Math.round(revenue * 100),
        frequency: null,
        reach: null,
        raw: row as Record<string, unknown>,
      });
    }
    return out;
  }

  applyAction(decision: ProviderDecision): Promise<ActionResult> {
    this.logger.warn(`applyAction(${decision.type}) — TikTok GMV Max é read-only no motor (copiloto)`);
    return Promise.resolve({
      ok: false,
      message:
        'Sugestão de TikTok GMV Max (copiloto). A escrita no GMV Max chega numa fase futura; por ora ajuste no painel do TikTok (Central do vendedor → Anúncios da loja).',
    });
  }

  // ── HTTP TikTok Marketing API ──────────────────────────────

  private resolveToken(): string | null {
    const t = (process.env.TIKTOK_ADS_ACCESS_TOKEN ?? '').trim();
    return t || null;
  }

  private resolveStoreIds(): string[] {
    return (process.env.TIKTOK_ADS_STORE_ID ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /**
   * GET na Marketing API com o envelope padrão `{ code, message, data }` e
   * paginação (`data.page_info`). Params de array vão como JSON (convenção do
   * TikTok: `dimensions=["campaign_id"]`). Lança em `code != 0`.
   */
  private async getPaged(
    token: string,
    path: string,
    params: Record<string, unknown>,
  ): Promise<Array<Record<string, unknown>>> {
    const all: Array<Record<string, unknown>> = [];
    let page = 1;
    const pageSize = 50;
    while (true) {
      const data = await this.get(token, path, { ...params, page, page_size: pageSize });
      const list = Array.isArray(data?.list) ? (data.list as Array<Record<string, unknown>>) : [];
      all.push(...list);
      const info = (data?.page_info ?? {}) as { total_page?: number; page?: number };
      const totalPage = Number(info.total_page ?? 1);
      if (!list.length || page >= totalPage || page >= 100) break;
      page += 1;
    }
    return all;
  }

  private async get(
    token: string,
    path: string,
    params: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null) continue;
      qs.set(k, Array.isArray(v) || typeof v === 'object' ? JSON.stringify(v) : String(v));
    }
    const res = await fetch(`${TT_BASE}${path}?${qs.toString()}`, {
      headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
    });
    const body = (await res.json().catch(() => ({}))) as {
      code?: number;
      message?: string;
      data?: Record<string, unknown>;
    };
    if (!res.ok || (body.code != null && body.code !== 0)) {
      throw new Error(`TikTok ${path} code=${body.code} ${body.message ?? `HTTP ${res.status}`}`);
    }
    return body.data ?? {};
  }
}

// ────────────────────────────────────────────
// Normalização TikTok → canônico
// ────────────────────────────────────────────

function ttStatus(status: string): EntityStatus {
  switch (status.toUpperCase()) {
    case 'ENABLE':
    case 'ENABLED':
    case 'CAMPAIGN_STATUS_ENABLE':
    case 'ACTIVE':
      return 'active';
    case 'DISABLE':
    case 'DISABLED':
    case 'PAUSE':
    case 'PAUSED':
    case 'CAMPAIGN_STATUS_DISABLE':
      return 'paused';
    case 'DELETE':
    case 'DELETED':
    case 'REMOVED':
      return 'archived';
    default:
      return 'paused';
  }
}

function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
