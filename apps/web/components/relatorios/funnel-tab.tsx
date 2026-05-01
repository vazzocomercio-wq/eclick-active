'use client';

import { AlertTriangle, Filter } from 'lucide-react';
import type { FunnelReport } from '@/lib/api/reports';
import { cn } from '@/lib/utils';

interface FunnelTabProps {
  data: FunnelReport | null;
  loading: boolean;
  pipelines: Array<{ id: string; name: string }>;
  selectedPipelineId: string | null;
  onSelectPipeline: (id: string) => void;
}

export function FunnelTab({
  data,
  loading,
  pipelines,
  selectedPipelineId,
  onSelectPipeline,
}: FunnelTabProps) {
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-3">
        <div className="h-64 animate-pulse rounded-xl bg-muted" />
        <div className="h-72 animate-pulse rounded-xl bg-muted" />
      </div>
    );
  }

  // Filtra stages normais (não won/lost) pra montar o funil visual
  const normalStages = data.stages.filter((s) => !s.is_won && !s.is_lost);
  const maxCount = Math.max(...normalStages.map((s) => s.deals_count), 1);
  const bottleneckId = data.bottleneck_stage_id;

  return (
    <div className="flex flex-col gap-4">
      {/* Pipeline selector + bottleneck callout */}
      <div className="flex flex-wrap items-center gap-3">
        {pipelines.length > 1 && (
          <label className="flex items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-1 text-xs">
            <Filter className="h-3 w-3 text-muted-foreground" />
            <span className="text-muted-foreground">Pipeline:</span>
            <select
              value={selectedPipelineId ?? ''}
              onChange={(e) => onSelectPipeline(e.target.value)}
              className="bg-transparent text-foreground focus:outline-none"
            >
              {pipelines.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}

        {bottleneckId && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-1.5 text-xs">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
            <span className="font-medium">Gargalo identificado:</span>
            <span className="text-destructive">
              {data.stages.find((s) => s.id === bottleneckId)?.name}
            </span>
          </div>
        )}
      </div>

      {/* Funil visual */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">{data.pipeline.name}</h2>

        {normalStages.length === 0 ? (
          <p className="text-xs text-muted-foreground">Sem stages ativos no pipeline.</p>
        ) : (
          <div className="flex flex-col items-center gap-1.5 py-3">
            {normalStages.map((s, idx) => {
              const widthPct = (s.deals_count / maxCount) * 100;
              const isBottleneck = s.id === bottleneckId;
              return (
                <div
                  key={s.id}
                  className="flex w-full max-w-2xl flex-col items-center animate-in fade-in slide-in-from-bottom-1"
                  style={{ animationDelay: `${idx * 50}ms`, animationFillMode: 'backwards' }}
                >
                  <div
                    className={cn(
                      'relative flex items-center justify-center rounded-md border px-4 py-3 transition-all',
                      isBottleneck
                        ? 'border-destructive/40 bg-destructive/10'
                        : 'border-border bg-background',
                    )}
                    style={{
                      width: `${Math.max(widthPct, 25)}%`,
                      minWidth: '180px',
                    }}
                  >
                    <span
                      className="absolute left-3 h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: s.color }}
                    />
                    <div className="flex flex-col items-center text-center">
                      <span className="text-xs font-semibold">{s.name}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {s.deals_count} deal{s.deals_count === 1 ? '' : 's'} ·{' '}
                        {formatBRL(s.total_value)}
                      </span>
                    </div>
                  </div>

                  {/* Conversion rate / drop-off entre stages */}
                  {idx < normalStages.length - 1 && s.conversion_rate !== null && (
                    <div className="my-1 flex items-center gap-2 text-[10px]">
                      {s.drop_off_rate !== null && s.drop_off_rate > 0 && (
                        <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-red-400">
                          -{s.drop_off_rate}% drop
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Tabela de detalhes */}
      <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Detalhes por etapa</h2>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 text-left font-medium">Etapa</th>
                <th className="pb-2 text-right font-medium">Deals</th>
                <th className="pb-2 text-right font-medium">Valor</th>
                <th className="pb-2 text-right font-medium">Tempo médio</th>
                <th className="pb-2 text-right font-medium">Conversão</th>
                <th className="pb-2 text-right font-medium">Drop-off</th>
              </tr>
            </thead>
            <tbody>
              {data.stages.map((s) => {
                const isBottleneck = s.id === bottleneckId;
                return (
                  <tr
                    key={s.id}
                    className={cn(
                      'border-b border-border/50 last:border-b-0',
                      isBottleneck && 'bg-destructive/5',
                    )}
                  >
                    <td className="py-2.5 text-left">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{ backgroundColor: s.color }}
                        />
                        <span className="font-medium">{s.name}</span>
                        {s.is_won && (
                          <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                            Ganho
                          </span>
                        )}
                        {s.is_lost && (
                          <span className="rounded-md bg-red-500/10 px-1.5 py-0.5 text-[10px] text-red-400">
                            Perdido
                          </span>
                        )}
                        {isBottleneck && (
                          <AlertTriangle className="h-3 w-3 text-destructive" />
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 text-right tabular-nums">{s.deals_count}</td>
                    <td className="py-2.5 text-right tabular-nums">
                      {s.total_value > 0 ? formatBRL(s.total_value) : '—'}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted-foreground">
                      {s.avg_time_in_stage_hours !== null
                        ? formatHours(s.avg_time_in_stage_hours)
                        : '—'}
                    </td>
                    <td
                      className={cn(
                        'py-2.5 text-right tabular-nums',
                        s.conversion_rate !== null && s.conversion_rate >= 50 && 'text-accent',
                      )}
                    >
                      {s.conversion_rate !== null ? `${s.conversion_rate}%` : '—'}
                    </td>
                    <td
                      className={cn(
                        'py-2.5 text-right tabular-nums',
                        isBottleneck && 'font-semibold text-destructive',
                      )}
                    >
                      {s.drop_off_rate !== null ? `${s.drop_off_rate}%` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function formatBRL(n: number): string {
  if (n >= 1_000_000) return `R$ ${(n / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}M`;
  if (n >= 10_000) return `R$ ${(n / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}k`;
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  });
}

function formatHours(h: number): string {
  if (h < 24) return `${h.toFixed(0)}h`;
  return `${Math.round(h / 24)}d`;
}
