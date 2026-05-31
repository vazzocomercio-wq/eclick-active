import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { AdsAccountsService, AdsAccountRow } from '../ads-accounts.service';

/** Dossiê de uma campanha — tudo em BRL reais, pronto pro LLM. */
export interface EntityDossier {
  external_id: string;
  name: string | null;
  objective: string | null;
  status: string;
  budget_brl: number | null;
  budget_type: string | null;
  data_days: number;
  window: {
    spend_brl: number;
    conversions: number;
    revenue_brl: number;
    impressions: number;
    clicks: number;
  };
  averages: {
    daily_spend_brl: number;
    /** custo por RESULTADO do objetivo (compra, lead, conversa, engajamento...). */
    cpa_brl: number | null;
    /** só faz sentido em objetivo de venda; null/0 fora disso. */
    roas: number | null;
    ctr_pct: number | null;
    cpm_brl: number | null;
    /** frequência média (impressões/pessoa) — alta + CTR caindo = fadiga. */
    avg_frequency: number | null;
    /** ACOS % (gasto÷receita) = inverso do ROAS — métrica soberana no ML Ads. */
    acos_pct: number | null;
  };
  trend: {
    roas_recent: number | null;
    roas_prior: number | null;
    roas_change_pct: number | null;
    cpa_recent_brl: number | null;
    cpa_prior_brl: number | null;
    label: 'improving' | 'declining' | 'stable' | 'insufficient';
  };
  recent_daily: Array<{
    date: string;
    spend_brl: number;
    conversions: number;
    roas: number | null;
  }>;
}

export interface AccountDossier {
  account_id: string;
  platform: string;
  currency: string;
  entities: EntityDossier[];
}

interface InsightRow {
  entity_id: string;
  date: string;
  spend_cents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenue_cents: number;
  frequency: number | null;
}

const MAX_CAMPAIGNS = 25;
const c2r = (cents: number): number => Math.round(cents) / 100;

/**
 * ENRICH — monta o dossiê normalizado de uma conta: por campanha, agregados
 * da janela + tendência (3 dias recentes vs 4 anteriores) + nº de dias com
 * dado. Tudo em BRL reais (o LLM raciocina melhor em moeda do que em centavos).
 */
@Injectable()
export class AdsDossierService {
  private readonly logger = new Logger(AdsDossierService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly accounts: AdsAccountsService,
  ) {}

  async buildAccountDossier(
    accountId: string,
    lookbackDays = 14,
  ): Promise<AccountDossier | null> {
    const acct = await this.accounts.getInternal(accountId);
    if (!acct) return null;

    const entities = await this.loadCampaignEntities(accountId);
    if (entities.length === 0) {
      return { account_id: accountId, platform: acct.platform, currency: acct.currency, entities: [] };
    }

    const since = new Date(Date.now() - lookbackDays * 86400_000)
      .toISOString()
      .slice(0, 10);
    const byEntity = await this.loadInsights(
      entities.map((e) => e.id),
      since,
    );

    const dossiers: EntityDossier[] = [];
    for (const e of entities) {
      const rows = (byEntity.get(e.id) ?? []).sort((a, b) =>
        a.date < b.date ? 1 : -1,
      ); // desc por data
      dossiers.push(this.buildEntityDossier(e, rows));
    }

    // top N por gasto na janela (mantém prompt limitado)
    dossiers.sort((a, b) => b.window.spend_brl - a.window.spend_brl);

    return {
      account_id: accountId,
      platform: acct.platform,
      currency: acct.currency,
      entities: dossiers.slice(0, MAX_CAMPAIGNS),
    };
  }

  // ── internals ──────────────────────────────────────────────

  private async loadCampaignEntities(accountId: string): Promise<
    Array<{
      id: string;
      external_id: string;
      name: string | null;
      objective: string | null;
      status: string;
      budget_cents: number | null;
      budget_type: string | null;
    }>
  > {
    const { data, error } = await this.supabase.adminClient
      .from('ads_entities')
      .select('id, external_id, name, objective, status, budget_cents, budget_type')
      .eq('account_id', accountId)
      .eq('level', 'campaign');
    if (error) {
      this.logger.warn(`loadCampaignEntities falhou: ${error.message}`);
      return [];
    }
    return (data ?? []) as unknown as Array<{
      id: string;
      external_id: string;
      name: string | null;
      objective: string | null;
      status: string;
      budget_cents: number | null;
      budget_type: string | null;
    }>;
  }

  private async loadInsights(
    entityIds: string[],
    since: string,
  ): Promise<Map<string, InsightRow[]>> {
    const map = new Map<string, InsightRow[]>();
    if (entityIds.length === 0) return map;
    const { data, error } = await this.supabase.adminClient
      .from('ads_insights')
      .select('entity_id, date, spend_cents, impressions, clicks, conversions, revenue_cents, frequency')
      .in('entity_id', entityIds)
      .gte('date', since);
    if (error) {
      this.logger.warn(`loadInsights falhou: ${error.message}`);
      return map;
    }
    for (const r of (data ?? []) as unknown as InsightRow[]) {
      const arr = map.get(r.entity_id) ?? [];
      arr.push(r);
      map.set(r.entity_id, arr);
    }
    return map;
  }

  private buildEntityDossier(
    e: {
      external_id: string;
      name: string | null;
      objective: string | null;
      status: string;
      budget_cents: number | null;
      budget_type: string | null;
    },
    rowsDesc: InsightRow[],
  ): EntityDossier {
    const dataDays = rowsDesc.length;

    const sum = (rs: InsightRow[]) =>
      rs.reduce(
        (a, r) => ({
          spend: a.spend + r.spend_cents,
          rev: a.rev + r.revenue_cents,
          imp: a.imp + r.impressions,
          clk: a.clk + r.clicks,
          conv: a.conv + r.conversions,
        }),
        { spend: 0, rev: 0, imp: 0, clk: 0, conv: 0 },
      );

    const tot = sum(rowsDesc);
    const roas = tot.spend > 0 ? tot.rev / tot.spend : null;
    const acosPct = tot.rev > 0 ? (tot.spend / tot.rev) * 100 : null;
    const cpaCents = tot.conv > 0 ? tot.spend / tot.conv : null;
    const ctr = tot.imp > 0 ? (tot.clk / tot.imp) * 100 : null;
    const cpmCents = tot.imp > 0 ? (tot.spend * 1000) / tot.imp : null;
    const dailySpend = dataDays > 0 ? tot.spend / dataDays : 0;
    const freqs = rowsDesc.map((r) => r.frequency).filter((f): f is number => f != null);
    const avgFreq = freqs.length > 0 ? freqs.reduce((a, b) => a + b, 0) / freqs.length : null;

    // tendência: 3 dias recentes vs 4 anteriores
    const recent = rowsDesc.slice(0, 3);
    const prior = rowsDesc.slice(3, 7);
    const tr = sum(recent);
    const tp = sum(prior);
    const roasRecent = tr.spend > 0 ? tr.rev / tr.spend : null;
    const roasPrior = tp.spend > 0 ? tp.rev / tp.spend : null;
    const cpaRecent = tr.conv > 0 ? tr.spend / tr.conv : null;
    const cpaPrior = tp.conv > 0 ? tp.spend / tp.conv : null;
    let roasChange: number | null = null;
    let label: EntityDossier['trend']['label'] = 'insufficient';
    if (dataDays < 2) {
      label = 'insufficient';
    } else if (roasRecent != null && roasPrior != null && roasPrior > 0) {
      roasChange = ((roasRecent - roasPrior) / roasPrior) * 100;
      label = roasChange > 10 ? 'improving' : roasChange < -10 ? 'declining' : 'stable';
    } else {
      label = 'stable';
    }

    return {
      external_id: e.external_id,
      name: e.name,
      objective: e.objective,
      status: e.status,
      budget_brl: e.budget_cents != null ? c2r(e.budget_cents) : null,
      budget_type: e.budget_type,
      data_days: dataDays,
      window: {
        spend_brl: c2r(tot.spend),
        conversions: round2(tot.conv),
        revenue_brl: c2r(tot.rev),
        impressions: tot.imp,
        clicks: tot.clk,
      },
      averages: {
        daily_spend_brl: c2r(dailySpend),
        cpa_brl: cpaCents != null ? c2r(cpaCents) : null,
        roas: roas != null ? round2(roas) : null,
        ctr_pct: ctr != null ? round2(ctr) : null,
        cpm_brl: cpmCents != null ? c2r(cpmCents) : null,
        avg_frequency: avgFreq != null ? round2(avgFreq) : null,
        acos_pct: acosPct != null ? round2(acosPct) : null,
      },
      trend: {
        roas_recent: roasRecent != null ? round2(roasRecent) : null,
        roas_prior: roasPrior != null ? round2(roasPrior) : null,
        roas_change_pct: roasChange != null ? round2(roasChange) : null,
        cpa_recent_brl: cpaRecent != null ? c2r(cpaRecent) : null,
        cpa_prior_brl: cpaPrior != null ? c2r(cpaPrior) : null,
        label,
      },
      recent_daily: recent.map((r) => ({
        date: r.date,
        spend_brl: c2r(r.spend_cents),
        conversions: round2(r.conversions),
        roas: r.spend_cents > 0 ? round2(r.revenue_cents / r.spend_cents) : null,
      })),
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
