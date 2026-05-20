'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowRight,
  CheckCircle2,
  FileText,
  GitBranch,
  Loader2,
  MessageCircle,
  Plug,
  Send,
  Sparkles,
  Tag,
  TrendingUp,
  Trophy,
  type LucideIcon,
  XCircle,
} from 'lucide-react';
import type { ContactTimelineEventType } from '@eclick-active/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { contactsApi, type ContactTimelineItem } from '@/lib/api/contacts';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

interface ContactHistoryTabProps {
  contactId: string;
}

/**
 * Aba "Histórico" do Contact Detail Sheet — timeline append-only de
 * `active.contact_timeline`. Eventos chegam via triggers SQL (deal_won,
 * stage_changed, score_changed) e via inserts manuais futuros.
 *
 * MVP read-only — sem input de "adicionar nota" aqui (notas internas
 * relevantes ficam no chat e em deal_activities). Pode ser adicionado depois.
 */
export function ContactHistoryTab({ contactId }: ContactHistoryTabProps) {
  const t = useTranslations('contacts.historyTab');
  const [items, setItems] = useState<ContactTimelineItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    contactsApi
      .getTimeline(contactId, ctrl.signal)
      .then(setItems)
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : t('fetchError'),
        );
      })
      .finally(() => setLoading(false));
    return () => ctrl.abort();
  }, [contactId]);

  if (loading) {
    return (
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="m-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return (
      <Card className="m-4 border-dashed">
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium">{t('emptyTitle')}</p>
          <p className="max-w-xs text-xs text-muted-foreground">
            {t('emptyDescription')}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="m-4">
      <CardContent className="flex flex-col p-0">
        <ol className="flex flex-col">
          {items.map((evt, idx) => (
            <TimelineRow
              key={evt.id}
              item={evt}
              isLast={idx === items.length - 1}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────
// TimelineRow
// ──────────────────────────────────────────────────────────

const ICON_MAP: Record<ContactTimelineEventType, LucideIcon> = {
  message_received: MessageCircle,
  message_sent: Send,
  deal_created: TrendingUp,
  deal_won: Trophy,
  deal_lost: XCircle,
  stage_changed: GitBranch,
  task_completed: CheckCircle2,
  note_added: FileText,
  tag_added: Tag,
  score_changed: TrendingUp,
  ai_insight: Sparkles,
  channel_connected: Plug,
  form_submitted: FileText,
};

function TimelineRow({
  item,
  isLast,
}: {
  item: ContactTimelineItem;
  isLast: boolean;
}) {
  const t = useTranslations('contacts.historyTab');
  const Icon = ICON_MAP[item.event_type] ?? FileText;
  const title = item.title ?? t(`titles.${item.event_type}`);
  const isAi = item.event_type === 'ai_insight' || item.created_by === null;

  return (
    <li
      className={cn(
        'flex items-start gap-3 px-4 py-3',
        !isLast && 'border-b border-border',
      )}
    >
      <span
        className={cn(
          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
          isAi ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>

      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-medium">{title}</span>
          {isAi && (
            <span className="inline-flex items-center gap-0.5 rounded-sm bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Sparkles className="h-2.5 w-2.5" />
              {t('aiBadge')}
            </span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground">
            {formatRelativeTime(item.created_at)}
          </span>
        </div>

        {/* score_changed visual: "45 → 72 (+27)" */}
        {item.event_type === 'score_changed' && <ScoreDelta metadata={item.metadata} />}

        {/* stage_changed visual: "Stage A → Stage B" */}
        {item.event_type === 'stage_changed' && <StageDelta metadata={item.metadata} />}

        {item.description && (
          <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
            {item.description}
          </p>
        )}
      </div>
    </li>
  );
}

function ScoreDelta({ metadata }: { metadata: unknown }) {
  const m = metadata as { from?: number; to?: number } | null;
  if (typeof m?.from !== 'number' || typeof m?.to !== 'number') return null;
  const delta = m.to - m.from;
  const isUp = delta > 0;
  return (
    <p className="flex items-center gap-1.5 text-xs">
      <span className="tabular-nums text-muted-foreground">{m.from}</span>
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      <span className="tabular-nums font-medium">{m.to}</span>
      <span
        className={cn(
          'rounded-sm px-1 text-[10px] font-semibold tabular-nums',
          isUp ? 'bg-accent/15 text-accent' : 'bg-orange-500/15 text-orange-400',
        )}
      >
        {isUp ? '+' : ''}
        {delta}
      </span>
    </p>
  );
}

function StageDelta({ metadata }: { metadata: unknown }) {
  const m = metadata as
    | { from_name?: string; to_name?: string; from_color?: string; to_color?: string }
    | null;
  if (!m?.from_name && !m?.to_name) return null;
  return (
    <p className="flex items-center gap-1.5 text-xs">
      {m.from_name && (
        <span
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: `${m.from_color ?? '#6B7280'}20`,
            color: m.from_color ?? '#6B7280',
          }}
        >
          {m.from_name}
        </span>
      )}
      <ArrowRight className="h-3 w-3 text-muted-foreground" />
      {m.to_name && (
        <span
          className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: `${m.to_color ?? '#6B7280'}20`,
            color: m.to_color ?? '#6B7280',
          }}
        >
          {m.to_name}
        </span>
      )}
    </p>
  );
}
