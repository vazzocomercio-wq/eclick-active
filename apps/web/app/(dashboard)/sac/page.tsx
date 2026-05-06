'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Headphones, Sparkles, RefreshCw, AlertTriangle, Clock, CheckCircle2, ShieldAlert, BarChart3 } from 'lucide-react';
import { useSacDashboard, useSacTickets } from '@/hooks/use-sac';
import { sacApi } from '@/lib/api/sac';
import { SacTicketsTable } from '@/components/sac/sac-tickets-table';
import { DiagnosticoIaCard } from '@/components/sac/diagnostico-ia-card';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function SacDashboardPage() {
  const { counts, loading: dashLoading, refresh: refreshDash } = useSacDashboard();
  const { data: critical } = useSacTickets({
    priority: ['critical', 'reputation_risk'],
    status: ['new', 'in_progress', 'reopened', 'waiting_customer', 'waiting_internal'],
    page_size: 6,
  });
  const { data: due } = useSacTickets({
    sla_breached: false,
    status: ['new', 'in_progress', 'reopened'],
    page_size: 6,
  });
  const { data: recent, loading: recentLoading, refresh: refreshList } = useSacTickets({
    page_size: 25,
  });

  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<unknown>(null);

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const res = await sacApi.ai.performance('week');
      setAnalysis(res);
    } catch {
      setAnalysis({ error: 'Falha ao gerar análise' });
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-3">
          <Headphones className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">SAC Inteligente</h1>
            <p className="text-xs text-muted-foreground">
              {counts ? `${counts.total_open} ticket(s) aberto(s)` : 'Carregando…'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sac/riscos">
              <ShieldAlert className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Riscos</span>
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sac/relatorios">
              <BarChart3 className="h-3.5 w-3.5" />
              <span className="hidden md:inline ml-1">Relatórios</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refreshDash();
              refreshList();
            }}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', dashLoading && 'animate-spin')} />
            <span className="hidden md:inline ml-1">Atualizar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runAnalysis}
            disabled={analyzing}
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span className="hidden md:inline ml-1">{analyzing ? 'Analisando…' : 'Diagnóstico IA'}</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* KPI cards */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard
            label="Novos"
            value={counts?.new ?? 0}
            color="cyan"
            icon={Headphones}
          />
          <KpiCard
            label="Críticos"
            value={counts?.critical ?? 0}
            color="red"
            pulse={(counts?.critical ?? 0) > 0}
            icon={AlertTriangle}
          />
          <KpiCard
            label="SLA <1h"
            value={counts?.sla_due_soon ?? 0}
            color="amber"
            icon={Clock}
          />
          <KpiCard
            label="SLA vencidos"
            value={counts?.sla_breached ?? 0}
            color="red"
            icon={Clock}
          />
          <KpiCard
            label="Risco rep."
            value={counts?.reputation_risk ?? 0}
            color="red"
            icon={ShieldAlert}
          />
          <KpiCard
            label="Resolvidos hoje"
            value={counts?.resolved_today ?? 0}
            color="emerald"
            icon={CheckCircle2}
          />
        </div>

        {/* Diagnóstico IA */}
        {analysis !== null && (
          <div className="mt-4">
            <DiagnosticoIaCard
              analysis={analysis}
              period="week"
              onClose={() => setAnalysis(null)}
            />
          </div>
        )}

        {/* Linha 2 — 3 colunas */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Section title="Tickets críticos" icon={AlertTriangle}>
            {critical?.rows.length === 0 ? (
              <EmptyHint>Nenhum ticket crítico aberto 🎉</EmptyHint>
            ) : (
              <SacTicketsTable tickets={critical?.rows ?? []} compact />
            )}
          </Section>

          <Section title="SLA vencendo" icon={Clock}>
            {due?.rows.length === 0 ? (
              <EmptyHint>Tudo dentro do prazo</EmptyHint>
            ) : (
              <SacTicketsTable tickets={due?.rows ?? []} compact />
            )}
          </Section>

          <Section title="Recomendações IA" icon={Sparkles}>
            <RecomendacoesPreview analysis={analysis} onAnalyze={runAnalysis} loading={analyzing} />
          </Section>
        </div>

        {/* Linha 3 — Tickets recentes */}
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold">Todos os tickets</h2>
          <SacTicketsTable
            tickets={recent?.rows ?? []}
            loading={recentLoading}
            emptyMessage="Sem tickets ainda. Tickets serão criados automaticamente quando a IA detectar pós-venda/suporte."
          />
        </div>
      </div>
    </div>
  );
}

interface KpiCardProps {
  label: string;
  value: number;
  color: 'cyan' | 'amber' | 'red' | 'emerald' | 'blue';
  pulse?: boolean;
  icon: typeof Headphones;
}

function KpiCard({ label, value, color, pulse, icon: Icon }: KpiCardProps) {
  const colorClasses = {
    cyan: 'border-cyan-500/30 bg-cyan-500/5 text-cyan-700 dark:text-cyan-300',
    amber: 'border-amber-500/30 bg-amber-500/5 text-amber-700 dark:text-amber-300',
    red: 'border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300',
    emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300',
    blue: 'border-blue-500/30 bg-blue-500/5 text-blue-700 dark:text-blue-300',
  }[color];

  return (
    <div
      className={cn(
        'flex flex-col gap-1 rounded-lg border bg-card p-3',
        value > 0 && colorClasses,
        value > 0 && pulse && 'animate-pulse',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <Icon className="h-3.5 w-3.5 opacity-60" />
      </div>
      <span className="text-2xl font-semibold leading-tight">{value}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof Headphones;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Icon className="h-4 w-4" />
        {title}
      </div>
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/10 p-4 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}

function RecomendacoesPreview({
  analysis,
  onAnalyze,
  loading,
}: {
  analysis: unknown;
  onAnalyze: () => void;
  loading: boolean;
}) {
  // Tenta extrair recommendations do output
  const recs = (() => {
    if (!analysis || typeof analysis !== 'object') return null;
    const r = (analysis as { recommendations?: unknown }).recommendations;
    if (!Array.isArray(r)) return null;
    return r.filter((x): x is string => typeof x === 'string').slice(0, 5);
  })();

  if (recs && recs.length > 0) {
    return (
      <ul className="flex flex-col gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/5 p-3 text-xs">
        {recs.map((r, i) => (
          <li key={i} className="flex gap-2 leading-relaxed text-foreground/85">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-500" />
            <span>{r}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3 text-center text-sm text-muted-foreground">
      <p className="mb-2 text-xs">Sem análise ainda</p>
      <Button size="sm" variant="outline" onClick={onAnalyze} disabled={loading}>
        <Sparkles className="h-3 w-3" />
        <span className="ml-1">{loading ? 'Analisando…' : 'Gerar agora'}</span>
      </Button>
    </div>
  );
}
