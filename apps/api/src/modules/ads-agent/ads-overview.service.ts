import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export interface AccountOverview {
  id: string;
  name: string | null;
  platform: string;
  status: string;
  spend_tier: string;
  decision_mode: string;
  last_polled_at: string | null;
  campaigns: number;
  active_campaigns: number;
  spend_cents: number;
  results: number;
  revenue_cents: number;
  cost_per_result_cents: number | null;
  roas: number | null;
}

export interface AdsOverview {
  window_days: number;
  totals: {
    accounts: number;
    active_accounts: number;
    campaigns: number;
    active_campaigns: number;
    spend_cents: number;
    results: number;
    revenue_cents: number;
    cost_per_result_cents: number | null;
    roas: number | null;
    pending_decisions: number;
  };
  accounts: AccountOverview[];
}

interface EntRow { id: string; account_id: string; status: string }
interface InsRow { entity_id: string; spend_cents: number; conversions: number; revenue_cents: number }

const WINDOW_DAYS = 7;

/**
 * Agrega os KPIs do motor pra org (janela 7d) — alimenta o hero + grid de
 * contas da Central de Ads numa chamada só. Cálculo em memória (poucas contas).
 */
@Injectable()
export class AdsOverviewService {
  private readonly logger = new Logger(AdsOverviewService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async getOverview(orgId: string): Promise<AdsOverview> {
    const db = this.supabase.adminClient;
    const since = new Date(Date.now() - WINDOW_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10);

    const [accRes, entRes, decRes] = await Promise.all([
      db
        .from('ads_accounts')
        .select('id, name, platform, status, spend_tier, decision_mode, last_polled_at')
        .eq('org_id', orgId)
        .neq('status', 'disconnected')
        .order('created_at', { ascending: true }),
      db
        .from('ads_entities')
        .select('id, account_id, status')
        .eq('org_id', orgId)
        .eq('level', 'campaign'),
      db
        .from('ads_decisions')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('status', 'pending'),
    ]);

    const accounts = (accRes.data ?? []) as unknown as Array<{
      id: string; name: string | null; platform: string; status: string;
      spend_tier: string; decision_mode: string; last_polled_at: string | null;
    }>;
    const entities = (entRes.data ?? []) as unknown as EntRow[];

    // entity → account + contagem de campanhas
    const entToAcc = new Map<string, string>();
    const campCount = new Map<string, number>();
    const activeCampCount = new Map<string, number>();
    for (const e of entities) {
      entToAcc.set(e.id, e.account_id);
      campCount.set(e.account_id, (campCount.get(e.account_id) ?? 0) + 1);
      if (e.status === 'active') {
        activeCampCount.set(e.account_id, (activeCampCount.get(e.account_id) ?? 0) + 1);
      }
    }

    // insights 7d → agrega por conta
    const spend = new Map<string, number>();
    const results = new Map<string, number>();
    const revenue = new Map<string, number>();
    const entIds = entities.map((e) => e.id);
    if (entIds.length > 0) {
      // chunk pra não estourar URL do PostgREST com muitos IDs
      const CHUNK = 200;
      for (let i = 0; i < entIds.length; i += CHUNK) {
        const slice = entIds.slice(i, i + CHUNK);
        const { data, error } = await db
          .from('ads_insights')
          .select('entity_id, spend_cents, conversions, revenue_cents')
          .in('entity_id', slice)
          .gte('date', since);
        if (error) {
          this.logger.warn(`overview insights falhou: ${error.message}`);
          continue;
        }
        for (const r of (data ?? []) as unknown as InsRow[]) {
          const acc = entToAcc.get(r.entity_id);
          if (!acc) continue;
          spend.set(acc, (spend.get(acc) ?? 0) + r.spend_cents);
          results.set(acc, (results.get(acc) ?? 0) + r.conversions);
          revenue.set(acc, (revenue.get(acc) ?? 0) + r.revenue_cents);
        }
      }
    }

    const accountOverviews: AccountOverview[] = accounts.map((a) => {
      const s = spend.get(a.id) ?? 0;
      const res = results.get(a.id) ?? 0;
      const rev = revenue.get(a.id) ?? 0;
      return {
        id: a.id,
        name: a.name,
        platform: a.platform,
        status: a.status,
        spend_tier: a.spend_tier,
        decision_mode: a.decision_mode,
        last_polled_at: a.last_polled_at,
        campaigns: campCount.get(a.id) ?? 0,
        active_campaigns: activeCampCount.get(a.id) ?? 0,
        spend_cents: s,
        results: round2(res),
        revenue_cents: rev,
        cost_per_result_cents: res > 0 ? Math.round(s / res) : null,
        roas: s > 0 ? round2(rev / s) : null,
      };
    });

    const totSpend = sum(accountOverviews.map((a) => a.spend_cents));
    const totRes = sum(accountOverviews.map((a) => a.results));
    const totRev = sum(accountOverviews.map((a) => a.revenue_cents));

    return {
      window_days: WINDOW_DAYS,
      totals: {
        accounts: accounts.length,
        active_accounts: accounts.filter((a) => a.status === 'active').length,
        campaigns: entities.length,
        active_campaigns: entities.filter((e) => e.status === 'active').length,
        spend_cents: totSpend,
        results: round2(totRes),
        revenue_cents: totRev,
        cost_per_result_cents: totRes > 0 ? Math.round(totSpend / totRes) : null,
        roas: totSpend > 0 ? round2(totRev / totSpend) : null,
        pending_decisions: decRes.count ?? 0,
      },
      accounts: accountOverviews,
    };
  }
}

function sum(ns: number[]): number {
  return ns.reduce((a, b) => a + b, 0);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
