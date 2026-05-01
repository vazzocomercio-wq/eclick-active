'use client';

import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Lightbulb,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { aiApi, type FunnelAnalysisResult } from '@/lib/api/ai';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface FunnelAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineId: string | null;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading_cache' }
  | { kind: 'cache'; analysis: FunnelAnalysisResult; generatedAt: string }
  | { kind: 'no_cache' }
  | { kind: 'analyzing' }
  | { kind: 'fresh'; analysis: FunnelAnalysisResult }
  | { kind: 'error'; message: string };

export function FunnelAnalysisDialog({
  open,
  onOpenChange,
  pipelineId,
}: FunnelAnalysisDialogProps) {
  const [state, setState] = useState<State>({ kind: 'idle' });

  // Ao abrir, tenta carregar o cache primeiro
  useEffect(() => {
    if (!open || !pipelineId) {
      setState({ kind: 'idle' });
      return;
    }
    setState({ kind: 'loading_cache' });
    aiApi
      .getFunnelInsights(pipelineId)
      .then((cached) => {
        if (cached.analysis && cached.generated_at) {
          setState({ kind: 'cache', analysis: cached.analysis, generatedAt: cached.generated_at });
        } else {
          setState({ kind: 'no_cache' });
        }
      })
      .catch((err) => {
        setState({
          kind: 'error',
          message: err instanceof ApiError ? err.message : 'Erro ao buscar análise',
        });
      });
  }, [open, pipelineId]);

  async function runAnalysis() {
    if (!pipelineId) return;
    setState({ kind: 'analyzing' });
    try {
      const result = await aiApi.analyzeFunnel(pipelineId);
      setState({ kind: 'fresh', analysis: result });
    } catch (err) {
      setState({
        kind: 'error',
        message: err instanceof ApiError ? err.message : 'Erro ao gerar análise',
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Análise de Funil
          </DialogTitle>
          <DialogDescription>
            Insights gerados pela IA com base no estado atual do pipeline e fechamentos
            dos últimos 30 dias.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto pr-1">
          {(state.kind === 'idle' || state.kind === 'loading_cache') && <SkeletonView />}

          {state.kind === 'no_cache' && (
            <EmptyView
              onAnalyze={runAnalysis}
              busy={false}
              cta="Gerar primeira análise"
              note="Nenhuma análise foi gerada ainda."
            />
          )}

          {state.kind === 'analyzing' && <AnalyzingView />}

          {state.kind === 'error' && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-destructive" />
              <p className="text-sm text-destructive">{state.message}</p>
              <Button onClick={runAnalysis} variant="outline">
                Tentar novamente
              </Button>
            </div>
          )}

          {(state.kind === 'cache' || state.kind === 'fresh') && (
            <ResultView
              analysis={state.analysis}
              generatedAt={state.kind === 'cache' ? state.generatedAt : null}
              onRefresh={runAnalysis}
              refreshing={false}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────

function ResultView({
  analysis,
  generatedAt,
  onRefresh,
  refreshing,
}: {
  analysis: FunnelAnalysisResult;
  generatedAt: string | null;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {generatedAt && (
        <div className="flex items-center justify-between rounded-md border border-border bg-card/50 px-3 py-2 text-xs text-muted-foreground">
          <span>Gerada {formatRelativeTime(generatedAt)}</span>
          <Button variant="ghost" size="sm" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn('mr-1.5 h-3.5 w-3.5', refreshing && 'animate-spin')} />
            Atualizar análise
          </Button>
        </div>
      )}

      {/* Big numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <BigNumber label="Total no funil" value={formatBRL(analysis.total_pipeline_value)} />
        <BigNumber label="Ponderado" value={formatBRL(analysis.weighted_value)} accent />
        <BigNumber
          label="Conversão"
          value={`${(analysis.conversion_rate * 100).toFixed(1)}%`}
        />
        <BigNumber
          label="Ciclo médio"
          value={
            analysis.avg_cycle_days > 0
              ? `${analysis.avg_cycle_days.toFixed(1)} dias`
              : '—'
          }
        />
      </div>

      {/* Bottleneck */}
      {analysis.bottleneck_stage && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/5 p-4">
          <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-red-500">
            <AlertTriangle className="h-4 w-4" />
            Gargalo identificado: {analysis.bottleneck_stage}
          </div>
          {analysis.bottleneck_reason && (
            <p className="text-sm text-foreground/80">{analysis.bottleneck_reason}</p>
          )}
        </div>
      )}

      {/* Insights */}
      {analysis.insights.length > 0 && (
        <Section icon={Lightbulb} iconColor="text-yellow-500" title="Insights">
          {analysis.insights.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-yellow-500" />
              <span>{line}</span>
            </li>
          ))}
        </Section>
      )}

      {/* Recommendations */}
      {analysis.recommendations.length > 0 && (
        <Section icon={Target} iconColor="text-primary" title="Recomendações">
          {analysis.recommendations.map((line, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-1.5 inline-block h-1 w-1 shrink-0 rounded-full bg-primary" />
              <span>{line}</span>
            </li>
          ))}
        </Section>
      )}
    </div>
  );
}

function Section({
  icon: Icon,
  iconColor,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-4">
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <Icon className={cn('h-3.5 w-3.5', iconColor)} />
        {title}
      </h3>
      <ul className="flex flex-col gap-2">{children}</ul>
    </div>
  );
}

function BigNumber({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p
        className={cn(
          'mt-1 text-lg font-semibold tabular-nums',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SkeletonView() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-20" />
        ))}
      </div>
      <Skeleton className="h-24" />
      <Skeleton className="h-32" />
    </div>
  );
}

function EmptyView({
  onAnalyze,
  busy,
  cta,
  note,
}: {
  onAnalyze: () => void;
  busy: boolean;
  cta: string;
  note: string;
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-12 text-center">
      <Sparkles className="h-8 w-8 text-primary" />
      <p className="text-sm text-muted-foreground">{note}</p>
      <Button onClick={onAnalyze} disabled={busy}>
        {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {cta}
      </Button>
    </div>
  );
}

function AnalyzingView() {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <div className="relative">
        <Sparkles className="h-8 w-8 text-primary" />
        <Loader2 className="absolute inset-0 h-8 w-8 animate-spin text-primary/30" />
      </div>
      <p className="text-sm font-medium">Analisando funil...</p>
      <p className="max-w-xs text-xs text-muted-foreground">
        A IA está examinando os deals, fechamentos recentes e identificando gargalos.
        Pode levar 5-15 segundos.
      </p>
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
