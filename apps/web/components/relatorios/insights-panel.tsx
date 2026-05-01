'use client';

import { Lightbulb, Loader2, Sparkles, Target } from 'lucide-react';
import type { InterpretResult } from '@/lib/api/reports';

interface InsightsPanelProps {
  loading: boolean;
  result: InterpretResult | null;
  error: string | null;
}

export function InsightsPanel({ loading, result, error }: InsightsPanelProps) {
  if (loading) {
    return (
      <section className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-5">
        <div className="flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          <span className="text-sm font-semibold">Analisando dados...</span>
        </div>
        <p className="text-xs text-muted-foreground">
          A IA está processando os números e gerando insights acionáveis.
        </p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </section>
    );
  }

  if (!result) return null;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-card p-5 animate-in fade-in slide-in-from-top-1 duration-300">
      <div className="flex items-start gap-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">
            Análise da IA
          </span>
          <p className="text-sm font-semibold leading-snug">{result.summary}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {result.insights.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-yellow-400">
              <Lightbulb className="h-3 w-3" />
              Insights
            </h3>
            <ul className="flex flex-col gap-1.5">
              {result.insights.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs leading-relaxed text-foreground"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-yellow-400" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.recommendations.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-emerald-400">
              <Target className="h-3 w-3" />
              Recomendações
            </h3>
            <ul className="flex flex-col gap-1.5">
              {result.recommendations.map((s, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-xs leading-relaxed text-foreground"
                >
                  <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-emerald-400" />
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
