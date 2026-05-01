'use client';

import { Crown } from 'lucide-react';
import type { AgentReport } from '@/lib/api/reports';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getInitials } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AgentsTabProps {
  data: AgentReport | null;
  loading: boolean;
}

export function AgentsTab({ data, loading }: AgentsTabProps) {
  if (loading || !data) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
        ))}
      </div>
    );
  }

  if (data.agents.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
        Sem dados de performance no período. Os agregados em
        <code className="mx-1 rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
          agent_performance
        </code>
        são calculados em jobs noturnos.
      </div>
    );
  }

  const maxRevenue = data.agents[0]?.revenue || 1;
  const maxConversations =
    Math.max(...data.agents.map((a) => a.conversations_handled)) || 1;
  const maxDealsWon = Math.max(...data.agents.map((a) => a.deals_won)) || 1;

  return (
    <div className="flex flex-col gap-3">
      {data.agents.map((a, idx) => (
        <article
          key={a.user_id}
          className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5 animate-in fade-in slide-in-from-bottom-1"
          style={{ animationDelay: `${idx * 30}ms`, animationFillMode: 'backwards' }}
        >
          {/* Header */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-10 w-10">
                {a.avatar_url && (
                  <AvatarImage src={a.avatar_url} alt={a.display_name ?? ''} />
                )}
                <AvatarFallback>{getInitials(a.display_name)}</AvatarFallback>
              </Avatar>
              {idx === 0 && data.agents.length > 1 && (
                <Crown className="absolute -right-1 -top-1 h-3.5 w-3.5 fill-yellow-400 text-yellow-400" />
              )}
            </div>

            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-sm font-semibold">
                {a.display_name ?? 'Sem nome'}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {a.tasks_completed} tarefa{a.tasks_completed === 1 ? '' : 's'} concluída{a.tasks_completed === 1 ? '' : 's'}
                {a.avg_first_response_ms !== null &&
                  ` · ${formatResponseTime(a.avg_first_response_ms)} 1ª resposta`}
              </span>
            </div>

            {a.ai_score !== null && (
              <div className="flex flex-col items-end">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Score IA
                </span>
                <span
                  className={cn(
                    'text-lg font-semibold tabular-nums',
                    a.ai_score >= 75 && 'text-accent',
                    a.ai_score >= 50 && a.ai_score < 75 && 'text-yellow-400',
                    a.ai_score < 50 && 'text-orange-400',
                  )}
                >
                  {a.ai_score}
                </span>
              </div>
            )}
          </div>

          {/* Bars comparativas */}
          <div className="grid grid-cols-3 gap-3">
            <ComparativeBar
              label="Conversas"
              value={a.conversations_handled}
              max={maxConversations}
              color="bg-blue-500/70"
              displayValue={String(a.conversations_handled)}
            />
            <ComparativeBar
              label="Deals ganhos"
              value={a.deals_won}
              max={maxDealsWon}
              color="bg-emerald-500/70"
              displayValue={`${a.deals_won}${a.deals_lost > 0 ? ` (${a.deals_lost} perdidos)` : ''}`}
            />
            <ComparativeBar
              label="Receita"
              value={a.revenue}
              max={maxRevenue}
              color="bg-primary/70"
              displayValue={formatBRL(a.revenue)}
            />
          </div>
        </article>
      ))}
    </div>
  );
}

function ComparativeBar({
  label,
  value,
  max,
  color,
  displayValue,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
  displayValue: string;
}) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        <span className="text-xs font-semibold tabular-nums">{displayValue}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn('h-full transition-all duration-500', color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function formatResponseTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}min`;
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
