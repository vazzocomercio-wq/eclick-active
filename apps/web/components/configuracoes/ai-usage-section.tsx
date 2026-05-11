'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DollarSign,
  Loader2,
  Lock,
  Receipt,
  Save,
  TrendingUp,
} from 'lucide-react';
import {
  settingsApi,
  type AiBudget,
  type AiUsageSummary,
  type AiUsageTimeline,
  type AiUsageTimelinePoint,
} from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

/**
 * Tela de Uso de IA — visibilidade + cap mensal.
 *
 * Dados:
 *   - Summary mês corrente (USD, chamadas, breakdown por feature/modelo)
 *   - Timeline 30d (série diária)
 *   - Budget (form com monthly_budget_usd, alert_threshold_pct, hard_cap)
 *
 * Tracking JÁ existe (active.ai_interactions); esta tela expõe + dá controle.
 */
export function AiUsageSection() {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [timeline, setTimeline] = useState<AiUsageTimeline | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Budget form state
  const [budgetDraft, setBudgetDraft] = useState<{
    monthly_budget_usd: string;
    alert_threshold_pct: number;
    hard_cap: boolean;
  }>({ monthly_budget_usd: '', alert_threshold_pct: 80, hard_cap: false });
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'ok' | 'err'>('idle');

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [s, t] = await Promise.all([
        settingsApi.getAiUsageSummary(),
        settingsApi.getAiUsageTimeline(30),
      ]);
      setSummary(s);
      setTimeline(t);
      setBudgetDraft({
        monthly_budget_usd:
          s.budget.monthly_budget_usd === null ? '' : String(s.budget.monthly_budget_usd),
        alert_threshold_pct: s.budget.alert_threshold_pct,
        hard_cap: s.budget.hard_cap,
      });
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar uso de IA',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function saveBudget() {
    setSaving(true);
    setSaveStatus('idle');
    try {
      const parsed = budgetDraft.monthly_budget_usd.trim();
      const monthly = parsed === '' ? null : Number(parsed);
      if (parsed !== '' && (!Number.isFinite(monthly) || monthly === null || monthly < 0)) {
        throw new Error('Valor de orçamento inválido. Use número >= 0 ou deixe vazio.');
      }
      await settingsApi.updateAiBudget({
        monthly_budget_usd: monthly,
        alert_threshold_pct: budgetDraft.alert_threshold_pct,
        hard_cap: budgetDraft.hard_cap,
      });
      setSaveStatus('ok');
      await reload();
      setTimeout(() => setSaveStatus('idle'), 2500);
    } catch (err) {
      setSaveStatus('err');
      setError(err instanceof Error ? err.message : 'Erro ao salvar orçamento');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl bg-muted" />;
  }
  if (!summary || !timeline) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error ?? 'Falha ao carregar uso de IA'}
      </div>
    );
  }

  const budget = summary.budget;
  const hasBudget = budget.monthly_budget_usd !== null && budget.monthly_budget_usd > 0;
  const pct = summary.pct_used;
  const overThreshold = hasBudget && pct >= budget.alert_threshold_pct;
  const overCap = hasBudget && pct >= 100;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Receipt className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Uso de IA</h2>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Acompanhe gasto mensal com chamadas LLM, defina orçamento e ative
          travamento automático ao atingir 100% do limite.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* Cards topo */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          label="Gasto no mês"
          value={`$${summary.total_usd.toFixed(2)}`}
          hint={`${summary.total_calls.toLocaleString('pt-BR')} chamadas`}
          icon={<DollarSign className="h-4 w-4" />}
        />
        <KpiCard
          label="Tokens (entrada/saída)"
          value={`${formatCompact(summary.total_input_tokens)} / ${formatCompact(summary.total_output_tokens)}`}
          hint="acumulado no mês"
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <KpiCard
          label="Orçamento"
          value={
            hasBudget
              ? `${pct.toFixed(1)}% de $${budget.monthly_budget_usd?.toFixed(2)}`
              : 'Não configurado'
          }
          hint={
            hasBudget
              ? budget.hard_cap
                ? 'Trava ativa em 100%'
                : `Alerta em ${budget.alert_threshold_pct}%`
              : 'Sem cap mensal'
          }
          icon={budget.hard_cap ? <Lock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          tone={overCap ? 'critical' : overThreshold ? 'warning' : 'neutral'}
        />
      </div>

      {/* Barra de progresso budget */}
      {hasBudget && (
        <div className="flex flex-col gap-1.5 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Uso do orçamento mensal</span>
            <span className="font-mono">
              ${summary.total_usd.toFixed(2)} / ${budget.monthly_budget_usd?.toFixed(2)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                'h-full transition-all',
                overCap ? 'bg-destructive' : overThreshold ? 'bg-amber-500' : 'bg-primary',
              )}
              style={{ width: `${Math.min(pct, 100)}%` }}
            />
          </div>
          {overCap && budget.hard_cap && (
            <p className="text-[11px] text-destructive">
              Limite atingido — novas chamadas de IA estão bloqueadas até virar o mês ou ajustar
              o orçamento.
            </p>
          )}
          {overThreshold && !overCap && (
            <p className="text-[11px] text-amber-500">
              Atingiu {pct.toFixed(1)}% do orçamento. Threshold de alerta:{' '}
              {budget.alert_threshold_pct}%.
            </p>
          )}
        </div>
      )}

      {/* Sparkline 30d */}
      <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Gasto diário (últimos 30 dias)
          </h3>
          <span className="text-[10px] text-muted-foreground">
            Pico: ${Math.max(...timeline.series.map((p) => p.usd), 0).toFixed(2)}
          </span>
        </div>
        <Sparkline series={timeline.series} />
      </div>

      {/* Breakdown por feature e modelo */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <BreakdownTable
          title="Por feature"
          rows={summary.by_feature}
          emptyHint="Nenhuma chamada de IA neste mês"
        />
        <BreakdownTable
          title="Por modelo"
          rows={summary.by_model}
          emptyHint="Nenhuma chamada de IA neste mês"
        />
      </div>

      {/* Form orçamento */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Orçamento e trava
          </h3>
          {saveStatus === 'ok' && (
            <span className="flex items-center gap-1 text-[11px] text-emerald-500">
              <CheckCircle2 className="h-3 w-3" /> Salvo
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground">Orçamento mensal (USD)</span>
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="ex: 50.00 (vazio = sem cap)"
              value={budgetDraft.monthly_budget_usd}
              onChange={(e) =>
                setBudgetDraft((d) => ({ ...d, monthly_budget_usd: e.target.value }))
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground">Alerta em (%)</span>
            <input
              type="number"
              min="1"
              max="100"
              value={budgetDraft.alert_threshold_pct}
              onChange={(e) =>
                setBudgetDraft((d) => ({
                  ...d,
                  alert_threshold_pct: Math.max(1, Math.min(100, Number(e.target.value) || 80)),
                }))
              }
              className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground">Trava em 100% (hard cap)</span>
            <div className="flex h-[34px] items-center gap-2 rounded-md border border-border bg-background px-2">
              <input
                type="checkbox"
                checked={budgetDraft.hard_cap}
                onChange={(e) => setBudgetDraft((d) => ({ ...d, hard_cap: e.target.checked }))}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-[11px] text-muted-foreground">
                {budgetDraft.hard_cap
                  ? 'Bloqueia chamadas ao atingir 100%'
                  : 'Apenas avisa (não bloqueia)'}
              </span>
            </div>
          </label>
        </div>

        <button
          type="button"
          onClick={() => void saveBudget()}
          disabled={saving}
          className={cn(
            'flex w-fit items-center gap-2 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground',
            saving && 'opacity-60',
          )}
        >
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Salvar orçamento
        </button>

        <p className="text-[10px] text-muted-foreground">
          Threshold dispara apenas alerta. Hard cap bloqueia <code>LlmService.chat()</code> com
          erro 400 ao atingir 100%, retomando no próximo mês ou após você aumentar o orçamento.
        </p>
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────
// Subcomponents
// ─────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  icon: React.ReactNode;
  tone?: 'neutral' | 'warning' | 'critical';
}) {
  const toneClass =
    tone === 'critical'
      ? 'border-destructive/50 bg-destructive/5'
      : tone === 'warning'
        ? 'border-amber-500/50 bg-amber-500/5'
        : 'border-border bg-card';
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-4', toneClass)}>
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        {icon}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="truncate text-sm font-semibold">{value}</span>
        <span className="truncate text-[10px] text-muted-foreground">{hint}</span>
      </div>
    </div>
  );
}

function BreakdownTable({
  title,
  rows,
  emptyHint,
}: {
  title: string;
  rows: Array<{ key: string; calls: number; usd: number }>;
  emptyHint: string;
}) {
  const total = rows.reduce((acc, r) => acc + r.usd, 0);
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rows.slice(0, 8).map((r) => {
            const pct = total > 0 ? (r.usd / total) * 100 : 0;
            return (
              <div key={r.key} className="flex flex-col gap-0.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-medium" title={r.key}>
                    {r.key}
                  </span>
                  <span className="ml-2 shrink-0 font-mono text-muted-foreground">
                    ${r.usd.toFixed(4)} · {r.calls.toLocaleString('pt-BR')}
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary/70"
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
              </div>
            );
          })}
          {rows.length > 8 && (
            <p className="text-[10px] text-muted-foreground">
              +{rows.length - 8} outras agrupadas
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Sparkline({ series }: { series: AiUsageTimelinePoint[] }) {
  const { path, max } = useMemo(() => {
    if (series.length === 0) return { path: '', max: 0 };
    const maxV = Math.max(...series.map((p) => p.usd), 0);
    const w = 600;
    const h = 80;
    const stepX = series.length > 1 ? w / (series.length - 1) : 0;
    const pts = series.map((p, i) => {
      const x = i * stepX;
      const y = maxV > 0 ? h - (p.usd / maxV) * (h - 8) - 4 : h - 4;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    return { path: `M ${pts.join(' L ')}`, max: maxV };
  }, [series]);

  return (
    <svg viewBox="0 0 600 80" preserveAspectRatio="none" className="h-20 w-full">
      <path
        d={`${path} L 600,80 L 0,80 Z`}
        fill="currentColor"
        className="text-primary/15"
      />
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-primary" />
      {max === 0 && (
        <text
          x="300"
          y="44"
          textAnchor="middle"
          fontSize="10"
          fill="currentColor"
          className="text-muted-foreground"
        >
          Sem chamadas no período
        </text>
      )}
    </svg>
  );
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
