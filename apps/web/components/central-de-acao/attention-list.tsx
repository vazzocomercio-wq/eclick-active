'use client';

import Link from 'next/link';
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  MessageCircle,
  TrendingDown,
} from 'lucide-react';
import type { AttentionItem } from '@/lib/api/dashboard';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface AttentionListProps {
  items: AttentionItem[];
  loading?: boolean;
}

export function AttentionList({ items, loading }: AttentionListProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/10 text-accent">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">Tudo em dia! 🎯</p>
        <p className="text-xs text-muted-foreground">
          Nenhum item urgente no momento. Bom trabalho.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {items.map((item, idx) => (
        <li
          key={item.id}
          className="animate-in fade-in slide-in-from-bottom-1"
          style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'backwards' }}
        >
          <AttentionRow item={item} />
        </li>
      ))}
    </ul>
  );
}

function AttentionRow({ item }: { item: AttentionItem }) {
  const { icon: Icon, color } = ATTENTION_VISUAL[item.kind];
  const sevStyle = SEVERITY_STYLE[item.severity];

  return (
    <Link
      href={item.href}
      className={cn(
        'group flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-all',
        'hover:border-primary/30 hover:bg-accent/5',
      )}
    >
      <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', color)}>
        <Icon className="h-4 w-4" />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{item.title}</span>
          <span
            className={cn(
              'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider',
              sevStyle.bg,
              sevStyle.text,
            )}
          >
            {sevStyle.label}
          </span>
        </div>
        <span className="truncate text-xs text-muted-foreground">
          {item.description} · {formatRelativeTime(item.since)}
        </span>
      </div>

      <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
    </Link>
  );
}

const ATTENTION_VISUAL: Record<AttentionItem['kind'], { icon: typeof AlertCircle; color: string }> = {
  unanswered_conversation: {
    icon: MessageCircle,
    color: 'bg-red-500/15 text-red-400',
  },
  sla_breached_deal: {
    icon: AlertTriangle,
    color: 'bg-orange-500/15 text-orange-400',
  },
  overdue_task: {
    icon: CalendarClock,
    color: 'bg-yellow-500/15 text-yellow-400',
  },
  high_risk_deal: {
    icon: TrendingDown,
    color: 'bg-red-500/15 text-red-400',
  },
};

const SEVERITY_STYLE: Record<
  AttentionItem['severity'],
  { bg: string; text: string; label: string }
> = {
  urgent: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Urgente' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Alta' },
  medium: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Média' },
};
