'use client';

import {
  Sparkles,
  AlertTriangle,
  Lightbulb,
  Package,
  MessageSquare,
  GraduationCap,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Render bonito do output JSON de SacAiService.analyzePerformance.
 * Parseia o objeto e mostra summary + bullets coloridos por categoria.
 *
 * Aceita o `analysis` cru (unknown) e tenta extrair os campos esperados
 * — se vier malformado, mostra fallback em <pre>.
 */
interface PerformanceAnalysis {
  summary?: string;
  main_issues?: string[];
  recommendations?: string[];
  products_with_problems?: Array<{ sku?: string; count?: number }>;
  channels_with_problems?: Array<{ channel?: string; count?: number }>;
  agents_needing_training?: Array<{ agent_id?: string; reason?: string }>;
  raw?: string;
  error?: string;
}

interface DiagnosticoIaCardProps {
  analysis: unknown;
  period: string;
  onClose?: () => void;
}

export function DiagnosticoIaCard({ analysis, period, onClose }: DiagnosticoIaCardProps) {
  const parsed = parseAnalysis(analysis);

  if (parsed?.error) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <p className="text-sm text-amber-700 dark:text-amber-400">
          Falha ao gerar diagnóstico: {parsed.error}
        </p>
      </div>
    );
  }

  if (!parsed) {
    return (
      <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/5 p-4">
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs text-foreground/80">
          {JSON.stringify(analysis, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-cyan-500/30 bg-gradient-to-br from-cyan-500/5 to-cyan-500/0 p-4 md:p-5">
      {/* Header */}
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-600 dark:text-cyan-400" />
          <h3 className="text-sm font-semibold text-cyan-700 dark:text-cyan-300">
            Diagnóstico IA — {periodLabel(period)}
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Fechar
          </button>
        )}
      </div>

      {/* Summary */}
      {parsed.summary && (
        <p className="mb-4 text-sm leading-relaxed text-foreground/85">
          {parsed.summary}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Main issues */}
        {parsed.main_issues && parsed.main_issues.length > 0 && (
          <Section
            title="Problemas principais"
            icon={AlertTriangle}
            color="red"
          >
            <ul className="space-y-2">
              {parsed.main_issues.map((issue, i) => (
                <Bullet key={i} color="red">
                  {issue}
                </Bullet>
              ))}
            </ul>
          </Section>
        )}

        {/* Recommendations */}
        {parsed.recommendations && parsed.recommendations.length > 0 && (
          <Section
            title="Recomendações"
            icon={Lightbulb}
            color="emerald"
          >
            <ul className="space-y-2">
              {parsed.recommendations.map((rec, i) => (
                <Bullet key={i} color="emerald">
                  {rec}
                </Bullet>
              ))}
            </ul>
          </Section>
        )}

        {/* Products with problems */}
        {parsed.products_with_problems && parsed.products_with_problems.length > 0 && (
          <Section
            title="Produtos problemáticos"
            icon={Package}
            color="orange"
          >
            <ul className="space-y-1.5 text-xs">
              {parsed.products_with_problems.slice(0, 5).map((p, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1">
                  <span className="font-mono">{p.sku ?? '—'}</span>
                  <span className="font-medium text-orange-600 dark:text-orange-400">
                    {p.count ?? 0}×
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Channels with problems */}
        {parsed.channels_with_problems && parsed.channels_with_problems.length > 0 && (
          <Section
            title="Canais com mais problemas"
            icon={MessageSquare}
            color="violet"
          >
            <ul className="space-y-1.5 text-xs">
              {parsed.channels_with_problems.slice(0, 5).map((c, i) => (
                <li key={i} className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/40 px-2 py-1">
                  <span>{c.channel ?? '—'}</span>
                  <span className="font-medium text-violet-600 dark:text-violet-400">
                    {c.count ?? 0}×
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* Agents needing training */}
        {parsed.agents_needing_training && parsed.agents_needing_training.length > 0 && (
          <Section
            title="Atendentes que precisam de treinamento"
            icon={GraduationCap}
            color="amber"
          >
            <ul className="space-y-1.5 text-xs">
              {parsed.agents_needing_training.slice(0, 5).map((a, i) => (
                <li
                  key={i}
                  className="rounded-md border border-border/60 bg-background/40 px-2 py-1"
                >
                  <div className="font-mono text-[10px] text-muted-foreground">
                    {a.agent_id ? a.agent_id.slice(0, 8) + '…' : '—'}
                  </div>
                  {a.reason && <p className="mt-0.5 text-foreground/80">{a.reason}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  icon: typeof Sparkles;
  color: 'red' | 'emerald' | 'orange' | 'violet' | 'amber';
  children: React.ReactNode;
}

function Section({ title, icon: Icon, color, children }: SectionProps) {
  const colorMap = {
    red: 'text-red-600 dark:text-red-400',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    orange: 'text-orange-600 dark:text-orange-400',
    violet: 'text-violet-600 dark:text-violet-400',
    amber: 'text-amber-600 dark:text-amber-400',
  };
  return (
    <div>
      <h4
        className={cn(
          'mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider',
          colorMap[color],
        )}
      >
        <Icon className="h-3 w-3" />
        {title}
      </h4>
      {children}
    </div>
  );
}

function Bullet({
  color,
  children,
}: {
  color: 'red' | 'emerald';
  children: React.ReactNode;
}) {
  const dotColor =
    color === 'red'
      ? 'bg-red-500'
      : color === 'emerald'
        ? 'bg-emerald-500'
        : 'bg-cyan-500';

  return (
    <li className="flex gap-2 text-xs leading-relaxed text-foreground/85">
      <span className={cn('mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full', dotColor)} />
      <span>{children}</span>
    </li>
  );
}

function periodLabel(period: string): string {
  if (period === 'today') return 'hoje';
  if (period === 'week') return 'últimos 7 dias';
  if (period === 'month') return 'últimos 30 dias';
  return period;
}

/** Tenta extrair campos do output IA. Retorna null se shape não bate. */
function parseAnalysis(input: unknown): PerformanceAnalysis | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.error === 'string') {
    return { error: obj.error };
  }

  // Caso a IA tenha respondido raw mas o parser do backend salvou em "raw"
  if (typeof obj.raw === 'string' && !obj.summary) {
    const recovered = tryParseJsonString(obj.raw);
    if (recovered) return recovered;
    return null;
  }

  const out: PerformanceAnalysis = {};

  if (typeof obj.summary === 'string') out.summary = obj.summary;
  if (Array.isArray(obj.main_issues)) {
    out.main_issues = obj.main_issues.filter((x): x is string => typeof x === 'string');
  }
  if (Array.isArray(obj.recommendations)) {
    out.recommendations = obj.recommendations.filter(
      (x): x is string => typeof x === 'string',
    );
  }
  if (Array.isArray(obj.products_with_problems)) {
    out.products_with_problems = obj.products_with_problems
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((p) => ({
        sku: typeof p.sku === 'string' ? p.sku : undefined,
        count: typeof p.count === 'number' ? p.count : undefined,
      }));
  }
  if (Array.isArray(obj.channels_with_problems)) {
    out.channels_with_problems = obj.channels_with_problems
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((c) => ({
        channel: typeof c.channel === 'string' ? c.channel : undefined,
        count: typeof c.count === 'number' ? c.count : undefined,
      }));
  }
  if (Array.isArray(obj.agents_needing_training)) {
    out.agents_needing_training = obj.agents_needing_training
      .filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object')
      .map((a) => ({
        agent_id: typeof a.agent_id === 'string' ? a.agent_id : undefined,
        reason: typeof a.reason === 'string' ? a.reason : undefined,
      }));
  }

  // Se nenhum campo conhecido foi extraído, considera que o JSON não bate
  if (
    !out.summary &&
    !out.main_issues &&
    !out.recommendations &&
    !out.products_with_problems &&
    !out.channels_with_problems &&
    !out.agents_needing_training
  ) {
    return null;
  }

  return out;
}

function tryParseJsonString(raw: string): PerformanceAnalysis | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parseAnalysis(parsed);
  } catch {
    return null;
  }
}
