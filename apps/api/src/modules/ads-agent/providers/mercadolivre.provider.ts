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
 * Fase 3 = WRITE. applyAction (pausar/ativar/orçamento/ACOS-alvo) chama a ponte
 * interna do SaaS `POST /internal/ml-ads/campaign-update` (X-Internal-Key), que
 * reusa MlAdsService.updateCampaign (PUT na API ML + espelho no DB). Nada de
 * token de ML aqui — o SaaS é dono da escrita, igual já é da coleta.
 *
 * Dinâmica ML ≠ Meta: muitas campanhas PADS não têm daily_budget (operam por
 * lance/ACOS-alvo) → budgetCents fica null nessas; a alavanca real dessas é o
 * acos_target (type "adjust_bid"). after.acos_target carrega o alvo numérico.
 */
@Injectable()
export class MercadoLivreAdsProvider implements AdProvider {
  readonly platform = 'mercadolivre' as const;
  private readonly logger = new Logger(MercadoLivreAdsProvider.name);

  constructor(private readonly supabase: SupabaseService) {}

  capabilities(): ProviderCapabilities {
    return {
      canAdjustBudget: true, // Fase 3: PUT budget via SaaS updateCampaign (campanhas c/ orçamento)
      canPauseEntity: true, // Fase 3: PUT status active/paused
      canAdjustBid: true, // Fase 3: PUT acos_target (lance/ACOS-alvo do PADS)
      canReallocateAcrossAdsets: false,
      hasLeadWebhook: false,
      minBudgetChangeStepCents: 100,
    };
  }

  async syncEntities(account: AdAccount): Promise<NormalizedEntity[]> {
    const { data, error } = await this.supabase.adminClient
      .from('v_saas_ml_ads_campaigns')
      .select('id, name, status, daily_budget, acos_target, strategy, type')
      .eq('organization_id', account.credentialRef) // saas_org_id
      .eq('advertiser_id', account.externalAccountId);
    if (error) {
      this.logger.warn(`syncEntities falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as unknown as Array<{
      id: string; name: string | null; status: string;
      daily_budget: number | string | null;
      acos_target: number | string | null; strategy: string | null;
      type: string | null;
    }>).map((c) => {
      const budget = c.daily_budget != null ? Number(c.daily_budget) : null;
      const acos = c.acos_target != null ? Number(c.acos_target) : null;
      return {
        level: 'campaign' as const,
        externalId: String(c.id),
        parentExternalId: null,
        name: c.name,
        objective: mlObjective(c.type),
        status: mlStatus(c.status),
        budgetCents: budget != null && Number.isFinite(budget) ? Math.round(budget * 100) : null,
        budgetType: budget != null ? ('daily' as const) : null,
        // raw carrega o ACOS-alvo atual (acos_target) + estratégia — o dossiê e o
        // analyze leem daqui pra propor/aplicar adjust_bid. acos_target é o
        // SETTING (lance-alvo), distinto do acos_pct REALIZADO (gasto÷receita).
        raw: {
          ...c,
          acos_target: acos != null && Number.isFinite(acos) ? acos : null,
        } as unknown as Record<string, unknown>,
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

  /**
   * APLICA de verdade no Mercado Livre via ponte do SaaS. Mapeia o tipo de
   * decisão → patch da campanha. Os valores vêm SEMPRE de `decision.after`
   * (no rollback o AdsApplyService já troca before↔after), então não importa
   * se é apply ou rollback — aplicamos o estado-alvo em `after`.
   */
  async applyAction(decision: ProviderDecision): Promise<ActionResult> {
    const after = decision.after ?? {};
    const patch: MlCampaignPatch = {};

    switch (decision.type) {
      case 'pause':
        patch.status = 'paused';
        break;
      case 'activate':
        patch.status = 'active';
        break;
      case 'scale_budget':
      case 'reduce_budget':
      case 'reallocate': {
        const cents = numOf(after.budget_cents);
        if (cents == null || cents <= 0) {
          return { ok: false, message: 'Orçamento-alvo ausente na decisão — não dá pra ajustar.' };
        }
        patch.daily_budget = Math.round(cents) / 100;
        break;
      }
      case 'adjust_bid': {
        const acos = numOf(after.acos_target);
        if (acos == null) {
          return {
            ok: false,
            message:
              'ACOS-alvo numérico ausente nesta decisão (gerada antes da Fase 3). Rode "Analisar tudo" de novo para regerar com alvo aplicável.',
          };
        }
        patch.acos_target = acos;
        break;
      }
      default:
        return { ok: false, message: `Tipo "${decision.type}" não aplicável no Mercado Livre.` };
    }

    return this.callSaasUpdate(decision.account.credentialRef, decision.entityExternalId, patch);
  }

  /**
   * Ponte HTTP Active → SaaS. `orgId` = saas_org_id (credentialRef da conta).
   * Auth por X-Internal-Key (mesma chave que as outras pontes Canva/blog).
   */
  private async callSaasUpdate(
    saasOrgId: string,
    campaignId: string,
    patch: MlCampaignPatch,
  ): Promise<ActionResult> {
    const base = (process.env.SAAS_API_URL ?? '').replace(/\/+$/, '');
    const key = process.env.SAAS_INTERNAL_KEY ?? process.env.INTERNAL_API_KEY;
    if (!base || !key) {
      this.logger.warn('ML applyAction: SAAS_API_URL/SAAS_INTERNAL_KEY ausentes no Active');
      return { ok: false, message: 'Ponte ML write não configurada (SAAS_API_URL/SAAS_INTERNAL_KEY).' };
    }
    try {
      const res = await fetch(`${base}/internal/ml-ads/campaign-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Internal-Key': key },
        body: JSON.stringify({ org_id: saasOrgId, campaign_id: campaignId, ...patch }),
      });
      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try { parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch { /* texto cru */ }
      if (!res.ok) {
        const detail = (parsed.message as string) ?? text?.slice(0, 200) ?? `HTTP ${res.status}`;
        this.logger.warn(`ML applyAction SaaS ${res.status}: ${detail}`);
        return { ok: false, message: `Mercado Livre rejeitou: ${detail}` };
      }
      return { ok: true, message: this.describe(patch), raw: parsed };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`ML applyAction erro de rede: ${message}`);
      return { ok: false, message: `Falha ao falar com o SaaS: ${message}` };
    }
  }

  private describe(patch: MlCampaignPatch): string {
    if (patch.acos_target != null) return `ACOS-alvo ajustado para ${patch.acos_target}%`;
    if (patch.daily_budget != null) return `Orçamento ajustado para R$ ${patch.daily_budget.toFixed(2)}`;
    if (patch.status === 'paused') return 'Campanha pausada';
    if (patch.status === 'active') return 'Campanha reativada';
    return 'Aplicado';
  }
}

interface MlCampaignPatch {
  status?: 'active' | 'paused';
  daily_budget?: number;
  acos_target?: number;
  strategy?: string;
}

function numOf(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
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
