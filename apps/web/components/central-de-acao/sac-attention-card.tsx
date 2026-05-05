'use client';

import Link from 'next/link';
import { Headphones, AlertTriangle, Clock, ShieldAlert, ChevronRight } from 'lucide-react';
import { useSacDashboard } from '@/hooks/use-sac';
import { cn } from '@/lib/utils';

/**
 * Bloco "SAC — Atenção imediata" pra Central de Ação. Mostra contagem de
 * tickets críticos, SLA vencendo e risco reputacional. Vermelho pulsante
 * quando algo precisa de ação. Click leva pro /sac.
 */
export function SacAttentionCard() {
  const { counts, loading } = useSacDashboard(60_000);

  const critical = counts?.critical ?? 0;
  const slaDue = counts?.sla_due_soon ?? 0;
  const slaBreached = counts?.sla_breached ?? 0;
  const reputation = counts?.reputation_risk ?? 0;

  const totalAlert = critical + slaBreached + reputation;
  const hasAlert = totalAlert > 0 || slaDue > 0;

  return (
    <Link
      href="/sac"
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-5 transition-colors',
        totalAlert > 0
          ? 'border-red-500/40 hover:border-red-500/60 bg-red-500/5'
          : 'border-border hover:border-border/80',
      )}
    >
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Headphones
            className={cn(
              'h-4 w-4',
              totalAlert > 0 ? 'text-red-500' : 'text-primary',
            )}
          />
          <h2 className="text-sm font-semibold">SAC — Atenção imediata</h2>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </header>

      {loading && !counts ? (
        <p className="text-xs text-muted-foreground">Carregando…</p>
      ) : !hasAlert ? (
        <p className="text-xs text-muted-foreground">
          Tudo sob controle 🎯 — sem tickets críticos, SLA dentro do prazo.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric
            icon={AlertTriangle}
            label="Críticos"
            value={critical}
            color="red"
            pulse={critical > 0}
          />
          <Metric
            icon={Clock}
            label="SLA <1h"
            value={slaDue}
            color="amber"
          />
          <Metric
            icon={Clock}
            label="SLA vencidos"
            value={slaBreached}
            color="red"
          />
          <Metric
            icon={ShieldAlert}
            label="Risco rep."
            value={reputation}
            color="red"
            pulse={reputation > 0}
          />
        </div>
      )}
    </Link>
  );
}

interface MetricProps {
  icon: typeof Headphones;
  label: string;
  value: number;
  color: 'red' | 'amber';
  pulse?: boolean;
}

function Metric({ icon: Icon, label, value, color, pulse }: MetricProps) {
  const colorCls = value > 0
    ? color === 'red'
      ? 'text-red-600 dark:text-red-400'
      : 'text-amber-600 dark:text-amber-400'
    : 'text-muted-foreground';

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-md border border-border/60 bg-background/40 p-2',
        pulse && value > 0 && 'animate-pulse',
      )}
    >
      <Icon className={cn('h-4 w-4 shrink-0', colorCls)} />
      <div className="min-w-0">
        <div className={cn('text-base font-semibold leading-none', colorCls)}>{value}</div>
        <div className="mt-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </div>
      </div>
    </div>
  );
}
