'use client';

import Link from 'next/link';
import {
  ArrowRightLeft,
  CheckCircle2,
  FileText,
  MessageCircleMore,
  Send,
  Trophy,
  XCircle,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { RecentActivityItem } from '@/lib/api/dashboard';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ActivityTimelineProps {
  items: RecentActivityItem[];
  loading?: boolean;
}

export function ActivityTimeline({ items, loading }: ActivityTimelineProps) {
  if (loading) {
    return (
      <div className="flex flex-col gap-2">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border p-6 text-center">
        <Zap className="h-5 w-5 text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Sem atividade recente</p>
      </div>
    );
  }

  return (
    <ol className="flex flex-col">
      {items.map((item, idx) => (
        <li
          key={item.id}
          className="animate-in fade-in"
          style={{ animationDelay: `${idx * 30}ms`, animationFillMode: 'backwards' }}
        >
          <ActivityRow item={item} isLast={idx === items.length - 1} />
        </li>
      ))}
    </ol>
  );
}

function ActivityRow({ item, isLast }: { item: RecentActivityItem; isLast: boolean }) {
  const visual = ACTIVITY_VISUAL[item.kind] ?? ACTIVITY_VISUAL.other;
  const Icon = visual.icon;

  const inner = (
    <div
      className={cn(
        'group flex items-start gap-3 py-2',
        item.href && 'cursor-pointer',
      )}
    >
      <div className="relative flex shrink-0 flex-col items-center">
        <div
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-full ring-2 ring-background',
            visual.color,
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </div>
        {!isLast && <span className="mt-0.5 h-full w-px flex-1 bg-border" />}
      </div>

      <div className="flex min-w-0 flex-1 flex-col pb-2">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm',
              item.href && 'group-hover:text-primary',
            )}
          >
            {item.title}
          </span>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {formatRelativeTime(item.created_at)}
          </span>
        </div>
        {(item.description || item.contact_name) && (
          <span className="truncate text-[11px] text-muted-foreground">
            {item.contact_name ? `${item.contact_name}` : ''}
            {item.contact_name && item.description ? ' · ' : ''}
            {item.description ?? ''}
          </span>
        )}
      </div>
    </div>
  );

  if (item.href) {
    return <Link href={item.href}>{inner}</Link>;
  }
  return inner;
}

const ACTIVITY_VISUAL: Record<
  RecentActivityItem['kind'],
  { icon: LucideIcon; color: string }
> = {
  message_received: { icon: MessageCircleMore, color: 'bg-blue-500/15 text-blue-400' },
  message_sent: { icon: Send, color: 'bg-cyan-500/15 text-cyan-400' },
  deal_stage_changed: { icon: ArrowRightLeft, color: 'bg-purple-500/15 text-purple-400' },
  deal_won: { icon: Trophy, color: 'bg-accent/20 text-accent' },
  deal_lost: { icon: XCircle, color: 'bg-red-500/15 text-red-400' },
  task_completed: { icon: CheckCircle2, color: 'bg-emerald-500/15 text-emerald-400' },
  note_added: { icon: FileText, color: 'bg-muted text-muted-foreground' },
  other: { icon: Zap, color: 'bg-muted text-muted-foreground' },
};
