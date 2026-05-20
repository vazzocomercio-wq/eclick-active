'use client';

import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  UserPlus,
  ArrowUp,
  StickyNote,
  Tag as TagIcon,
  Package,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { SacTicketAction } from '@/lib/api/sac';
import { cn } from '@/lib/utils';

const ACTION_ICONS: Record<string, typeof Sparkles> = {
  created: Sparkles,
  status_changed: RotateCw,
  priority_changed: ArrowUp,
  category_changed: TagIcon,
  assigned: UserPlus,
  escalated: ArrowUp,
  note_added: StickyNote,
  response_sent: CheckCircle2,
  order_linked: Package,
  sla_breached: AlertCircle,
  resolved: CheckCircle2,
  reopened: RotateCw,
  ai_classified: Sparkles,
  preventive_created: Sparkles,
  customer_rated: CheckCircle2,
};

const LABEL_KEYS = new Set([
  'created', 'status_changed', 'priority_changed', 'category_changed',
  'assigned', 'escalated', 'note_added', 'response_sent', 'order_linked',
  'order_checked', 'logistics_contacted', 'refund_initiated',
  'exchange_initiated', 'sla_breached', 'resolved', 'reopened',
  'ai_classified', 'ai_suggested', 'preventive_created', 'customer_rated',
]);

interface TicketTimelineProps {
  actions: SacTicketAction[];
}

export function TicketTimeline({ actions }: TicketTimelineProps) {
  const t = useTranslations('sac.timeline');
  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        {t('empty')}
      </div>
    );
  }
  return (
    <ol className="flex flex-col">
      {actions.map((a, i) => {
        const Icon = ACTION_ICONS[a.action_type] ?? Sparkles;
        const label = LABEL_KEYS.has(a.action_type) ? t(`labels.${a.action_type}`) : a.action_type;
        const time = formatTime(a.created_at, t);
        return (
          <li key={a.id} className="relative flex gap-3 pb-3">
            {i < actions.length - 1 && (
              <div className="absolute left-[15px] top-7 bottom-0 w-px bg-border" />
            )}
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                a.action_type === 'sla_breached'
                  ? 'border-red-500/40 bg-red-500/10 text-red-600'
                  : a.action_type === 'resolved'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : a.actor_type === 'ai'
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600'
                      : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 pt-1">
              <div className="text-sm font-medium">{label}</div>
              {a.description && (
                <div className="mt-0.5 text-xs text-foreground/70">{a.description}</div>
              )}
              {(a.old_value || a.new_value) && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {a.old_value && <span className="font-mono">{a.old_value}</span>}
                  {a.old_value && a.new_value && <span> → </span>}
                  {a.new_value && <span className="font-mono">{a.new_value}</span>}
                </div>
              )}
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {time}
                {a.actor_type === 'ai' && ` • ${t('actor.ai')}`}
                {a.actor_type === 'system' && ` • ${t('actor.system')}`}
                {a.actor_type === 'customer' && ` • ${t('actor.customer')}`}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatTime(
  iso: string,
  t: (key: string, vars?: Record<string, number>) => string,
): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return t('now');
    if (min < 60) return t('minutesAgo', { n: min });
    if (min < 1440) return t('hoursAgo', { n: Math.floor(min / 60) });
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
