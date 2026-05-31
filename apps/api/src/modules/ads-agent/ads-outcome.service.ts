import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';

export type Verdict = 'positive' | 'negative' | 'neutral';

export interface WindowMetrics {
  days: number;
  spend_cents: number;
  results: number;
  revenue_cents: number;
  spend_per_day_cents: number;
  results_per_day: number;
  cpa_cents: number | null;
  roas: number | null;
}

interface AppliedDecision {
  id: string;
  org_id: string;
  entity_id: string;
  type: string;
  applied_at: string;
}
interface InsRow {
  date: string; spend_cents: number; conversions: number; revenue_cents: number;
}

const BEFORE_WINDOW_DAYS = 7;

/**
 * MVP-3b — LOOP DE APRENDIZADO (medição). Para cada decisão aplicada cuja
 * janela (measure_after, default +72h) venceu e ainda não tem outcome, compara
 * a performance da entidade ANTES × DEPOIS do apply (pivô = applied_at) e grava
 * `ads_outcomes` com veredito. Ratios (cpa/roas) são neutros a tamanho de
 * janela; volumes são normalizados por dia.
 */
@Injectable()
export class AdsOutcomeService {
  private readonly logger = new Logger(AdsOutcomeService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async measureDue(limit = 50): Promise<{ measured: number }> {
    const nowIso = new Date().toISOString();
    const { data, error } = await this.supabase.adminClient
      .from('ads_decisions')
      .select('id, org_id, entity_id, type, applied_at')
      .eq('status', 'applied')
      .not('applied_at', 'is', null)
      .lte('measure_after', nowIso)
      .order('measure_after', { ascending: true })
      .limit(limit);
    if (error) {
      this.logger.warn(`measureDue query falhou: ${error.message}`);
      return { measured: 0 };
    }
    const decs = (data ?? []) as unknown as AppliedDecision[];
    if (decs.length === 0) return { measured: 0 };

    // pula os que já têm outcome
    const ids = decs.map((d) => d.id);
    const { data: existing } = await this.supabase.adminClient
      .from('ads_outcomes')
      .select('decision_id')
      .in('decision_id', ids);
    const done = new Set(
      ((existing ?? []) as Array<{ decision_id: string }>).map((o) => o.decision_id),
    );

    let measured = 0;
    for (const d of decs) {
      if (done.has(d.id)) continue;
      try {
        await this.measureOne(d);
        measured += 1;
      } catch (err) {
        this.logger.warn(
          `measureOne[${d.id}] falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (measured > 0) this.logger.log(`outcomes medidos: ${measured}`);
    return { measured };
  }

  private async measureOne(d: AppliedDecision): Promise<void> {
    const appliedDate = d.applied_at.slice(0, 10);
    const since = new Date(new Date(d.applied_at).getTime() - BEFORE_WINDOW_DAYS * 86400_000)
      .toISOString()
      .slice(0, 10);

    const { data, error } = await this.supabase.adminClient
      .from('ads_insights')
      .select('date, spend_cents, conversions, revenue_cents')
      .eq('entity_id', d.entity_id)
      .gte('date', since)
      .order('date', { ascending: true });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as InsRow[];

    const before = aggregate(rows.filter((r) => r.date < appliedDate));
    const after = aggregate(rows.filter((r) => r.date >= appliedDate));
    const { verdict, delta } = judge(d.type, before, after);

    const windowHours = Math.max(
      1,
      Math.round((Date.now() - new Date(d.applied_at).getTime()) / 3600_000),
    );

    const { error: insErr } = await this.supabase.adminClient.from('ads_outcomes').insert({
      org_id: d.org_id,
      decision_id: d.id,
      window_hours: windowHours,
      before_metrics: before as unknown as Record<string, unknown>,
      after_metrics: after as unknown as Record<string, unknown>,
      delta,
      verdict,
    });
    if (insErr) throw new Error(insErr.message);
    this.logger.log(`outcome[${d.id}] ${d.type} → ${verdict}`);
  }
}

// ────────────────────────────────────────────
// agregação + veredito
// ────────────────────────────────────────────

function aggregate(rows: InsRow[]): WindowMetrics {
  const days = rows.length;
  const spend = rows.reduce((a, r) => a + r.spend_cents, 0);
  const results = rows.reduce((a, r) => a + r.conversions, 0);
  const revenue = rows.reduce((a, r) => a + r.revenue_cents, 0);
  return {
    days,
    spend_cents: spend,
    results: round2(results),
    revenue_cents: revenue,
    spend_per_day_cents: days > 0 ? Math.round(spend / days) : 0,
    results_per_day: days > 0 ? round2(results / days) : 0,
    cpa_cents: results > 0 ? Math.round(spend / results) : null,
    roas: spend > 0 ? round2(revenue / spend) : null,
  };
}

function pctChange(before: number | null, after: number | null): number | null {
  if (before == null || after == null || before === 0) return null;
  return round2(((after - before) / before) * 100);
}

function judge(
  type: string,
  bm: WindowMetrics,
  am: WindowMetrics,
): { verdict: Verdict; delta: Record<string, unknown> } {
  const delta = {
    cpa_change_pct: pctChange(bm.cpa_cents, am.cpa_cents),
    results_per_day_change_pct: pctChange(bm.results_per_day, am.results_per_day),
    spend_per_day_change_pct: pctChange(bm.spend_per_day_cents, am.spend_per_day_cents),
    roas_change_pct: pctChange(bm.roas, am.roas),
  };

  let verdict: Verdict = 'neutral';

  if (type === 'pause') {
    // sucesso = o gasto efetivamente parou
    if (am.spend_per_day_cents <= bm.spend_per_day_cents * 0.2) verdict = 'positive';
    else verdict = 'neutral';
    return { verdict, delta };
  }

  // demais: julga por custo-por-resultado (menor = melhor)
  if (bm.cpa_cents != null && am.cpa_cents != null) {
    const c = delta.cpa_change_pct ?? 0;
    if (c <= -10) verdict = 'positive';
    else if (c >= 20) verdict = 'negative';
    else if (type === 'scale_budget' && (delta.results_per_day_change_pct ?? 0) > 10) {
      verdict = 'positive'; // escalou: cpa estável e mais resultado/dia
    } else verdict = 'neutral';
    return { verdict, delta };
  }

  // fallback por ROAS quando não há cpa (objetivo de venda sem resultado contável)
  if (bm.roas != null && am.roas != null) {
    const r = delta.roas_change_pct ?? 0;
    verdict = r >= 10 ? 'positive' : r <= -20 ? 'negative' : 'neutral';
    return { verdict, delta };
  }

  return { verdict: 'neutral', delta };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
