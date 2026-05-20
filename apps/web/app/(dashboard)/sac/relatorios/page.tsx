'use client';

import { useState } from 'react';
import { BarChart3, Sparkles, Clock, CheckCircle2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSacSlaStats, useSacDashboard } from '@/hooks/use-sac';
import { sacApi } from '@/lib/api/sac';
import { DiagnosticoIaCard } from '@/components/sac/diagnostico-ia-card';
import { Button } from '@/components/ui/button';

export default function SacReportsPage() {
  const t = useTranslations('sac.reports');
  const [days, setDays] = useState(30);
  const { stats, loading } = useSacSlaStats(days);
  const { counts } = useSacDashboard(60_000);

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<unknown>(null);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await sacApi.ai.performance(days <= 7 ? 'week' : 'month');
      setAnalysis(res);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">{t('title')}</h1>
            <p className="text-xs text-muted-foreground">
              {t('metricsLast')}{' '}
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="bg-transparent font-medium text-foreground focus:outline-none"
              >
                <option value={7}>{t('days7')}</option>
                <option value={30}>{t('days30')}</option>
                <option value={90}>{t('days90')}</option>
              </select>
            </p>
          </div>
        </div>
        <Button size="sm" onClick={runAnalysis} disabled={analyzing}>
          <Sparkles className="h-3.5 w-3.5" />
          <span className="ml-1">{analyzing ? t('analyzing') : t('diagnose')}</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <KpiCard
            label={t('kpi.slaFulfilled')}
            value={`${stats?.fulfilled_pct ?? 0}%`}
            sub={loading ? '…' : t('kpi.slaFulfilledSub', {
              fulfilled: stats?.fulfilled ?? 0,
              total: (stats?.fulfilled ?? 0) + (stats?.breached ?? 0),
            })}
            icon={CheckCircle2}
            color="emerald"
          />
          <KpiCard
            label={t('kpi.slaBreached')}
            value={String(stats?.breached ?? 0)}
            icon={Clock}
            color="red"
          />
          <KpiCard
            label={t('kpi.avgFirstResponse')}
            value={formatMin(stats?.avg_first_response_minutes ?? 0)}
            icon={Clock}
            color="amber"
          />
          <KpiCard
            label={t('kpi.avgResolution')}
            value={formatMin(stats?.avg_resolution_minutes ?? 0)}
            icon={Clock}
            color="blue"
          />
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">{t('openTodaySnapshot')}</h2>
            <ul className="space-y-1 text-sm">
              <Stat label={t('stat.new')} value={counts?.new ?? 0} />
              <Stat label={t('stat.in_progress')} value={counts?.in_progress ?? 0} />
              <Stat label={t('stat.waiting_customer')} value={counts?.waiting_customer ?? 0} />
              <Stat label={t('stat.waiting_internal')} value={counts?.waiting_internal ?? 0} />
              <Stat label={t('stat.resolved_today')} value={counts?.resolved_today ?? 0} highlight="emerald" />
              <Stat label={t('stat.critical')} value={counts?.critical ?? 0} highlight="red" />
              <Stat label={t('stat.reputation_risk')} value={counts?.reputation_risk ?? 0} highlight="red" />
            </ul>
          </div>

          {analysis !== null && (
            <DiagnosticoIaCard
              analysis={analysis}
              period={days <= 7 ? 'week' : 'month'}
              onClose={() => setAnalysis(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: typeof BarChart3;
  color: 'emerald' | 'red' | 'amber' | 'blue';
}) {
  const c =
    color === 'emerald'
      ? 'text-emerald-600 dark:text-emerald-400'
      : color === 'red'
        ? 'text-red-600 dark:text-red-400'
        : color === 'amber'
          ? 'text-amber-600 dark:text-amber-400'
          : 'text-blue-600 dark:text-blue-400';
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
        <Icon className={`h-3.5 w-3.5 ${c}`} />
      </div>
      <div className={`mt-1 text-2xl font-semibold ${c}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: number; highlight?: 'red' | 'emerald' }) {
  return (
    <li className="flex items-center justify-between border-b border-border/40 py-1 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={`font-medium ${
          highlight === 'red'
            ? 'text-red-600 dark:text-red-400'
            : highlight === 'emerald'
              ? 'text-emerald-600 dark:text-emerald-400'
              : ''
        }`}
      >
        {value}
      </span>
    </li>
  );
}

function formatMin(min: number): string {
  if (min < 60) return `${Math.round(min)}m`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
