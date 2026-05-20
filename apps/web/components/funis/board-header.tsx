'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus, RefreshCw, Settings, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { BoardResponse } from '@/lib/api/pipelines';
import type { Pipeline } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

interface BoardHeaderProps {
  pipelines: Pipeline[];
  selectedPipelineId: string | null;
  onSelectPipeline: (id: string) => void;
  summary: BoardResponse['summary'] | null;
  loading: boolean;
  onRefresh: () => void;
  onCreateDeal: () => void;
  onAnalyze: () => void;
}

export function BoardHeader({
  pipelines,
  selectedPipelineId,
  onSelectPipeline,
  summary,
  loading,
  onRefresh,
  onCreateDeal,
  onAnalyze,
}: BoardHeaderProps) {
  const t = useTranslations('funis.board.header');
  return (
    <header className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
      {/* Esquerda: título + seletor */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{t('title')}</h1>
          {pipelines.length > 1 && (
            <select
              value={selectedPipelineId ?? ''}
              onChange={(e) => onSelectPipeline(e.target.value)}
              className={cn(
                'h-8 rounded-md border border-input bg-background px-2 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
              aria-label={t('pipelineSelector')}
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t('subtitle')}
        </p>
      </div>

      {/* Centro: métricas */}
      {summary && (
        <div className="flex items-center gap-6">
          <Metric label={t('totalLabel')} value={formatBRL(summary.total_value)} />
          <Metric
            label={t('weightedLabel')}
            value={formatBRL(summary.weighted_value)}
            hint={
              summary.total_deals === 1
                ? t('dealHint', { count: summary.total_deals })
                : t('dealsHint', { count: summary.total_deals })
            }
            accent
          />
        </div>
      )}

      {/* Direita: ações */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onRefresh}
          disabled={loading}
          aria-label={t('reload')}
          title={t('reload')}
        >
          <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
        <Button asChild variant="outline" size="icon" aria-label={t('settings')}>
          <Link href="/funis/configuracoes" title={t('settingsTitle')}>
            <Settings className="h-4 w-4" />
          </Link>
        </Button>
        <Button variant="outline" onClick={onAnalyze} disabled={!summary}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          {t('analyze')}
        </Button>
        <Button onClick={onCreateDeal} disabled={!selectedPipelineId}>
          <Plus className="mr-1.5 h-4 w-4" />
          {t('newDeal')}
        </Button>
      </div>
    </header>
  );
}

interface MetricProps {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}

function Metric({ label, value, hint, accent }: MetricProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-base font-semibold tabular-nums',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </span>
      {hint && <span className="text-[10px] text-muted-foreground">{hint}</span>}
    </div>
  );
}

function formatBRL(n: number): string {
  if (!Number.isFinite(n)) return 'R$ 0';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
