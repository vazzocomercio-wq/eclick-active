'use client';

import { BarChart3, Sparkles } from 'lucide-react';

/**
 * Placeholder de estatísticas. Implementação completa puxa de
 * `ai_interactions` agregado por mês — depende de novo endpoint
 * `/ai/stats?period=...` que ainda não existe.
 */
export function StatsTab() {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center">
        <BarChart3 className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Estatísticas de IA</h3>
        <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
          Métricas agregadas (interações por mês, custo, distribuição por tipo,
          confiança média, top intenções, latência) requerem o endpoint
          <code className="mx-1 rounded bg-muted px-1 py-0.5">GET /ai/stats</code>
          e charts com recharts. Em breve.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-[11px]">
          <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
            <Sparkles className="h-3 w-3" /> Próximo: bloco de relatórios IA
          </span>
        </div>
      </div>
    </div>
  );
}
