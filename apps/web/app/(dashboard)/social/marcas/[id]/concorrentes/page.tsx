'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Users,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  Lightbulb,
} from 'lucide-react';
import { useBrand } from '@/hooks/use-social';
import { socialApi, type CompetitorAnalysis } from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export default function CompetitorAnalysisPage() {
  const params = useParams<{ id: string }>();
  const brandId = params?.id ?? null;
  const { brand } = useBrand(brandId);
  const [analysis, setAnalysis] = useState<CompetitorAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!brandId) return;
    void (async () => {
      try {
        const a = await socialApi.competitor.latest(brandId);
        setAnalysis(a);
      } finally {
        setLoading(false);
      }
    })();
  }, [brandId]);

  const generate = async () => {
    if (!brandId) return;
    setGenerating(true);
    try {
      const a = await socialApi.competitor.generate(brandId);
      setAnalysis(a);
    } catch (err) {
      alert(`Erro: ${err instanceof Error ? err.message : 'desconhecido'}`);
    } finally {
      setGenerating(false);
    }
  };

  if (!brand || loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Carregando…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/social/marcas/${brandId}`}>
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <Users className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">
              Análise de concorrentes
            </h1>
            <p className="text-xs text-muted-foreground">{brand.name}</p>
          </div>
        </div>
        <Button size="sm" onClick={generate} disabled={generating}>
          <Sparkles className="h-3.5 w-3.5" />
          <span className="ml-1">
            {generating
              ? 'Analisando…'
              : analysis
                ? 'Refazer análise'
                : 'Gerar análise'}
          </span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {brand.reference_accounts.length === 0 ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
            <p className="font-medium text-amber-700 dark:text-amber-300">
              ⚠️ Cadastre os concorrentes primeiro
            </p>
            <p className="mt-1 text-foreground/80">
              Vá em{' '}
              <Link
                href={`/social/marcas/${brandId}`}
                className="text-primary underline"
              >
                editar marca
              </Link>{' '}
              → aba &quot;Referências&quot; e adicione os handles dos concorrentes
              (ex: @concorrente1, @concorrente2).
            </p>
          </div>
        ) : !analysis ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center">
            <Users className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Nenhuma análise gerada ainda. A IA vai analisar como sua marca se
              compara aos concorrentes monitorados:
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-1">
              {brand.reference_accounts.map((h) => (
                <span
                  key={h}
                  className="rounded-full bg-muted px-2 py-0.5 text-xs"
                >
                  {h}
                </span>
              ))}
            </div>
            <Button size="sm" className="mt-4" onClick={generate} disabled={generating}>
              <Sparkles className="h-3.5 w-3.5" />
              <span className="ml-1">{generating ? 'Analisando…' : 'Gerar agora'}</span>
            </Button>
            <p className="mt-2 text-[10px] text-muted-foreground">
              ⚠️ A análise é estimativa baseada em conhecimento do nicho — Active
              não tem acesso aos perfis em tempo real.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {/* Summary */}
            {analysis.summary && (
              <div className="rounded-xl border border-cyan-500/30 bg-cyan-500/5 p-4">
                <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-cyan-700 dark:text-cyan-300">
                  <Sparkles className="h-4 w-4" />
                  Posicionamento da marca
                </h2>
                <p className="text-sm leading-relaxed text-foreground/85">
                  {analysis.summary}
                </p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Gerada em {new Date(analysis.generated_at).toLocaleString('pt-BR')}
                </p>
              </div>
            )}

            {/* Strengths + Weaknesses */}
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <Section
                title="Pontos fortes"
                icon={TrendingUp}
                color="emerald"
                items={analysis.strengths.map((s) => ({
                  title: s.title,
                  description: s.description,
                }))}
              />
              <Section
                title="Pontos fracos"
                icon={TrendingDown}
                color="red"
                items={analysis.weaknesses.map((w) => ({
                  title: w.title,
                  description: w.description,
                }))}
              />
            </div>

            {/* Opportunities */}
            {analysis.opportunities.length > 0 && (
              <section className="rounded-xl border border-border bg-card p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Target className="h-4 w-4 text-violet-500" />
                  Oportunidades
                </h2>
                <ul className="flex flex-col gap-2">
                  {analysis.opportunities.map((o, i) => (
                    <li
                      key={i}
                      className={cn(
                        'rounded-md border p-3 text-sm',
                        o.priority === 'high'
                          ? 'border-red-500/30 bg-red-500/5'
                          : o.priority === 'medium'
                            ? 'border-amber-500/30 bg-amber-500/5'
                            : 'border-border bg-background',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{o.title}</p>
                        <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase">
                          {o.priority}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/70">
                        {o.description}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Competitor estimates */}
            {analysis.competitor_estimates.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <AlertTriangle className="h-4 w-4 text-amber-500" />
                  Concorrentes — estimativas IA
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {analysis.competitor_estimates.map((c, i) => (
                    <div
                      key={i}
                      className="rounded-lg border border-border bg-card p-3"
                    >
                      <p className="font-mono text-sm font-semibold text-blue-600 dark:text-blue-400">
                        {c.handle}
                      </p>
                      <p className="mt-1 text-xs text-foreground/70">
                        <span className="font-medium">Estratégia estimada:</span>{' '}
                        {c.estimated_strategy}
                      </p>
                      {c.estimated_strengths.length > 0 && (
                        <div className="mt-2">
                          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                            Forças estimadas
                          </p>
                          <ul className="mt-0.5 list-inside list-disc text-xs text-foreground/80">
                            {c.estimated_strengths.map((s, j) => (
                              <li key={j}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {c.differentiation_opportunity && (
                        <div className="mt-2 rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2 text-[11px]">
                          💡 <span className="font-medium">Oportunidade:</span>{' '}
                          {c.differentiation_opportunity}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Recommendations */}
            {analysis.recommendations.length > 0 && (
              <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                  <Lightbulb className="h-4 w-4" />
                  Ações recomendadas
                </h2>
                <ul className="flex flex-col gap-2">
                  {analysis.recommendations.map((r, i) => (
                    <li
                      key={i}
                      className="rounded-md border border-border bg-background p-3 text-sm"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{r.action}</p>
                        <span
                          className={cn(
                            'rounded-full px-1.5 py-0.5 text-[10px] uppercase tracking-wider',
                            r.effort === 'low'
                              ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'
                              : r.effort === 'medium'
                                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                                : 'bg-red-500/20 text-red-700 dark:text-red-300',
                          )}
                        >
                          {r.effort === 'low'
                            ? 'fácil'
                            : r.effort === 'medium'
                              ? 'médio'
                              : 'pesado'}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-foreground/70">
                        {r.rationale}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  color,
  items,
}: {
  title: string;
  icon: typeof TrendingUp;
  color: 'emerald' | 'red';
  items: Array<{ title: string; description: string }>;
}) {
  if (items.length === 0) return null;
  const cls = {
    emerald: 'text-emerald-600 dark:text-emerald-400',
    red: 'text-red-600 dark:text-red-400',
  }[color];
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className={cn('mb-3 flex items-center gap-2 text-sm font-semibold', cls)}>
        <Icon className="h-4 w-4" />
        {title}
      </h2>
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => (
          <li
            key={i}
            className="rounded-md border border-border bg-background p-3 text-sm"
          >
            <p className="font-medium">{item.title}</p>
            <p className="mt-1 text-xs text-foreground/70">{item.description}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
