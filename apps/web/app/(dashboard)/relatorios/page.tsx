'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  Cable,
  Sparkles,
  TrendingUp,
  Users,
  Workflow,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  reportsApi,
  type AgentReport,
  type ChannelReport,
  type FunnelReport,
  type InterpretResult,
  type ReportType,
  type SalesReport,
} from '@/lib/api/reports';
import { pipelinesApi, type PipelineWithStages } from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import {
  PeriodSelector,
  defaultPeriod,
  type Period,
} from '@/components/relatorios/period-selector';
import { InsightsPanel } from '@/components/relatorios/insights-panel';
import { SalesTab } from '@/components/relatorios/sales-tab';
import { AgentsTab } from '@/components/relatorios/agents-tab';
import { ChannelsTab } from '@/components/relatorios/channels-tab';
import { FunnelTab } from '@/components/relatorios/funnel-tab';
import { cn } from '@/lib/utils';

type Tab = 'sales' | 'agents' | 'channels' | 'funnel';

const TABS: Array<{ id: Tab; label: string; icon: typeof BarChart3 }> = [
  { id: 'sales', label: 'Vendas', icon: TrendingUp },
  { id: 'agents', label: 'Equipe', icon: Users },
  { id: 'channels', label: 'Canais', icon: Cable },
  { id: 'funnel', label: 'Funil', icon: Workflow },
];

export default function RelatoriosPage() {
  const [tab, setTab] = useState<Tab>('sales');
  const [period, setPeriod] = useState<Period>(defaultPeriod);

  // Data por aba
  const [sales, setSales] = useState<SalesReport | null>(null);
  const [agents, setAgents] = useState<AgentReport | null>(null);
  const [channels, setChannels] = useState<ChannelReport | null>(null);
  const [funnel, setFunnel] = useState<FunnelReport | null>(null);

  const [salesLoading, setSalesLoading] = useState(false);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [funnelLoading, setFunnelLoading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Pipelines (para a aba Funil)
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [selectedPipelineId, setSelectedPipelineId] = useState<string | null>(null);

  // Insights (IA)
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [insights, setInsights] = useState<InterpretResult | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);

  // Carrega pipelines
  useEffect(() => {
    pipelinesApi
      .list()
      .then((list) => {
        setPipelines(list);
        const def = list.find((p) => p.is_default) ?? list[0];
        if (def) setSelectedPipelineId(def.id);
      })
      .catch(() => setPipelines([]));
  }, []);

  // Fetch da aba ativa quando period muda ou tab muda
  const fetchActive = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        if (tab === 'sales') {
          setSalesLoading(true);
          setSales(await reportsApi.sales(period, signal));
        } else if (tab === 'agents') {
          setAgentsLoading(true);
          setAgents(await reportsApi.agents(period, signal));
        } else if (tab === 'channels') {
          setChannelsLoading(true);
          setChannels(await reportsApi.channels(period, signal));
        } else if (tab === 'funnel' && selectedPipelineId) {
          setFunnelLoading(true);
          setFunnel(await reportsApi.funnel(selectedPipelineId, period, signal));
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao carregar relatório',
        );
      } finally {
        setSalesLoading(false);
        setAgentsLoading(false);
        setChannelsLoading(false);
        setFunnelLoading(false);
      }
    },
    [tab, period, selectedPipelineId],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    void fetchActive(ctrl.signal);
    // Quando muda tab/period/pipeline, fecha o painel da IA pra evitar
    // mostrar interpretação de outro relatório
    setInsightsOpen(false);
    setInsights(null);
    return () => ctrl.abort();
  }, [fetchActive]);

  // Interpretação com IA — usa os dados da aba ativa
  const currentReportData = useMemo<{
    type: ReportType;
    data: Record<string, unknown>;
  } | null>(() => {
    if (tab === 'sales' && sales) return { type: 'sales', data: sales as unknown as Record<string, unknown> };
    if (tab === 'agents' && agents) return { type: 'agents', data: agents as unknown as Record<string, unknown> };
    if (tab === 'channels' && channels) return { type: 'channels', data: channels as unknown as Record<string, unknown> };
    if (tab === 'funnel' && funnel) return { type: 'funnel', data: funnel as unknown as Record<string, unknown> };
    return null;
  }, [tab, sales, agents, channels, funnel]);

  async function handleInterpret() {
    if (!currentReportData) return;
    setInsightsOpen(true);
    setInsightsLoading(true);
    setInsightsError(null);
    setInsights(null);
    try {
      const result = await reportsApi.interpret(
        currentReportData.type,
        currentReportData.data,
      );
      setInsights(result);
    } catch (err) {
      setInsightsError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao interpretar',
      );
    } finally {
      setInsightsLoading(false);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h1 className="text-lg font-semibold">Relatórios</h1>
          </div>
          <p className="text-xs text-muted-foreground">
            Métricas de vendas, equipe, canais e funil — interpretadas pela IA.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <PeriodSelector value={period} onChange={setPeriod} />

          <Button
            variant="outline"
            size="sm"
            onClick={handleInterpret}
            disabled={insightsLoading || currentReportData === null}
          >
            <Sparkles className="mr-2 h-3.5 w-3.5" />
            Interpretar com IA
          </Button>
        </div>
      </header>

      {/* Tabs */}
      <nav className="flex shrink-0 gap-1 overflow-x-auto border-b border-border px-6 py-2">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          );
        })}
      </nav>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {insightsOpen && (
            <InsightsPanel
              loading={insightsLoading}
              result={insights}
              error={insightsError}
            />
          )}

          {tab === 'sales' && <SalesTab data={sales} loading={salesLoading} />}
          {tab === 'agents' && <AgentsTab data={agents} loading={agentsLoading} />}
          {tab === 'channels' && (
            <ChannelsTab data={channels} loading={channelsLoading} />
          )}
          {tab === 'funnel' && (
            <FunnelTab
              data={funnel}
              loading={funnelLoading}
              pipelines={pipelines}
              selectedPipelineId={selectedPipelineId}
              onSelectPipeline={setSelectedPipelineId}
            />
          )}
        </div>
      </div>
    </div>
  );
}
