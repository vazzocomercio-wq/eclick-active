import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
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
 * Adaptador Mercado Livre Ads (3º provider). NÃO reimplementa a API de ML Ads:
 * o SaaS (eclick-backend, módulo ml-ads) JÁ coleta campanhas + métricas diárias
 * (cron 6h) em public.ml_ads_campaigns / ml_ads_reports, e já tem o WRITE
 * (updateCampaign). Este provider LÊ esses dados via as views-ponte
 * active.v_saas_ml_ads_* (mig 097).
 *
 * Mapeamento de org: `credential_ref` da ads_accounts guarda o **saas_org_id**
 * (de active.organizations.saas_org_id, resolvido no enroll); `external_account_id`
 * = advertiser_id do ML. Não precisa de token aqui (leitura é do DB).
 *
 * Fase 1 = read-only. applyAction (pausar/orçamento/ACOS) chega na Fase 3,
 * reusando MlAdsService.updateCampaign do SaaS (via bridge HTTP).
 *
 * Dinâmica ML ≠ Meta: muitas campanhas PADS não têm daily_budget (operam por
 * lance/ACOS-alvo) → budgetCents fica null nessas; a alavanca real (ajuste de
 * ACOS/lance) entra no playbook ML + applyAction da Fase 3.
 */
@Injectable()
export class MercadoLivreAdsProvider implements AdProvider {
  readonly platform = 'mercadolivre' as const;
  private readonly logger = new Logger(MercadoLivreAdsProvider.name);

  constructor(private readonly supabase: SupabaseService) {}

  capabilities(): ProviderCapabilities {
    return {
      canAdjustBudget: false, // write chega na Fase 3 (SaaS updateCampaign)
      canPauseEntity: false,
      canAdjustBid: false, // ACOS/lance — alavanca real do ML, Fase 3
      canReallocateAcrossAdsets: false,
      hasLeadWebhook: false,
      minBudgetChangeStepCents: 100,
    };
  }

  async syncEntities(account: AdAccount): Promise<NormalizedEntity[]> {
    const { data, error } = await this.supabase.adminClient
      .from('v_saas_ml_ads_campaigns')
      .select('id, name, status, daily_budget, type')
      .eq('organization_id', account.credentialRef) // saas_org_id
      .eq('advertiser_id', account.externalAccountId);
    if (error) {
      this.logger.warn(`syncEntities falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as unknown as Array<{
      id: string; name: string | null; status: string;
      daily_budget: number | string | null; type: string | null;
    }>).map((c) => {
      const budget = c.daily_budget != null ? Number(c.daily_budget) : null;
      return {
        level: 'campaign' as const,
        externalId: String(c.id),
        parentExternalId: null,
        name: c.name,
        objective: mlObjective(c.type),
        status: mlStatus(c.status),
        budgetCents: budget != null && Number.isFinite(budget) ? Math.round(budget * 100) : null,
        budgetType: budget != null ? ('daily' as const) : null,
        raw: c as unknown as Record<string, unknown>,
      };
    });
  }

  async fetchInsights(
    account: AdAccount,
    range: DateRange,
    entities: NormalizedEntity[],
  ): Promise<NormalizedInsight[]> {
    const ids = entities.map((e) => e.externalId);
    if (ids.length === 0) return [];
    const since = range.since.toISOString().slice(0, 10);

    const { data, error } = await this.supabase.adminClient
      .from('v_saas_ml_ads_reports')
      .select('campaign_id, date, spend, impressions, clicks, conversions, revenue')
      .eq('organization_id', account.credentialRef)
      .gte('date', since)
      .in('campaign_id', ids);
    if (error) {
      this.logger.warn(`fetchInsights falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as unknown as Array<{
      campaign_id: string; date: string;
      spend: number | string | null; impressions: number | string | null;
      clicks: number | string | null; conversions: number | string | null;
      revenue: number | string | null;
    }>).map((r) => ({
      entityExternalId: String(r.campaign_id),
      level: 'campaign' as const,
      date: r.date,
      spendCents: Math.round(Number(r.spend ?? 0) * 100),
      impressions: Math.round(Number(r.impressions ?? 0)),
      clicks: Math.round(Number(r.clicks ?? 0)),
      conversions: Number(r.conversions ?? 0),
      revenueCents: Math.round(Number(r.revenue ?? 0) * 100),
      frequency: null,
      reach: null,
      raw: r as unknown as Record<string, unknown>,
    }));
  }

  applyAction(decision: ProviderDecision): Promise<ActionResult> {
    this.logger.warn(`applyAction(${decision.type}) — ML write chega na Fase 3`);
    return Promise.resolve({
      ok: false,
      message:
        'Aplicação no Mercado Livre Ads chega na Fase 3 (reusa o updateCampaign do SaaS). Por ora, read-only.',
    });
  }
}

// ────────────────────────────────────────────
// Normalização ML → canônico
// ────────────────────────────────────────────

function mlStatus(status: string | null): EntityStatus {
  switch ((status ?? '').toLowerCase()) {
    case 'active':
      return 'active';
    case 'paused':
      return 'paused';
    case 'archived':
    case 'deleted':
    case 'finished':
      return 'archived';
    default:
      return 'paused';
  }
}

/** type do ML Ads (PADS/BADS/DISPLAY) → objetivo canônico. */
function mlObjective(type: string | null): string | null {
  const t = (type ?? '').toUpperCase();
  if (t.includes('BAD') || t.includes('BRAND')) return 'awareness';
  if (t.includes('DISPLAY')) return 'awareness';
  // PADS / product_ads = venda de catálogo (ACOS/ROAS são soberanos)
  return 'catalog_sales';
}
