'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Layers, List, Plus, Sparkles } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  contentCalendarApi,
  type ContentCalendarEvent,
  type ContentChannel,
  type ContentStatus,
  STATUS_LABEL,
} from '@/lib/api/content-calendar';
import { CalendarMonthView } from '@/components/content-calendar/calendar-month-view';
import { CalendarWeekView } from '@/components/content-calendar/calendar-week-view';
import { CalendarListView } from '@/components/content-calendar/calendar-list-view';
import { ChannelColorLegend } from '@/components/content-calendar/channel-color-legend';
import { EventDrawer } from '@/components/content-calendar/event-drawer';
import { AIPlanGenerator } from '@/components/content-calendar/ai-plan-generator';
import { addDaysIsoDate, formatDateKey } from '@/components/content-calendar/calendar-utils';
import { cn } from '@/lib/utils';

type ViewMode = 'month' | 'week' | 'list';

const STATUSES: ContentStatus[] = [
  'idea',
  'planned',
  'content_ready',
  'approved',
  'scheduled',
  'published',
  'cancelled',
];

export default function CalendarioConteudoPage() {
  const t = useTranslations('contentCalendar');
  const [view, setView] = useState<ViewMode>('month');
  const [events, setEvents] = useState<ContentCalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [channelFilter, setChannelFilter] = useState<ContentChannel[]>([]);
  const [statusFilter, setStatusFilter] = useState<ContentStatus | 'all'>('all');
  const [productLinkedOnly, setProductLinkedOnly] = useState(false);

  // Drawer / Modal
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<ContentCalendarEvent | null>(null);
  const [aiOpen, setAiOpen] = useState(false);

  // Range fetch — pega ±60 dias do hoje (cobre mês corrente + adjacentes)
  const range = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const fromDate = new Date(today);
    fromDate.setDate(fromDate.getDate() - 60);
    const toDate = new Date(today);
    toDate.setDate(toDate.getDate() + 90);
    return { from: formatDateKey(fromDate), to: formatDateKey(toDate) };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contentCalendarApi.list({
        from: range.from,
        to: range.to,
      });
      setEvents(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Filtros aplicados
  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (channelFilter.length > 0 && !channelFilter.includes(e.channel)) {
        return false;
      }
      if (statusFilter !== 'all' && e.status !== statusFilter) {
        return false;
      }
      if (productLinkedOnly && !e.product_id) {
        return false;
      }
      return true;
    });
  }, [events, channelFilter, statusFilter, productLinkedOnly]);

  // Handlers
  const onEventClick = useCallback((e: ContentCalendarEvent) => {
    setEditing(e);
    setDrawerOpen(true);
  }, []);

  const onCreate = useCallback(() => {
    setEditing(null);
    setDrawerOpen(true);
  }, []);

  const onSaved = useCallback((saved: ContentCalendarEvent) => {
    setEvents((prev) => {
      const idx = prev.findIndex((e) => e.id === saved.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = saved;
        return next;
      }
      return [...prev, saved];
    });
  }, []);

  const onDeleted = useCallback((id: string) => {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }, []);

  // Drag-and-drop reschedule (otimista + rollback se falhar)
  const onReschedule = useCallback(
    async (eventId: string, newDate: string) => {
      const original = events.find((e) => e.id === eventId);
      if (!original) return;
      if (original.scheduled_date === newDate) return;
      // optimistic
      setEvents((prev) =>
        prev.map((e) =>
          e.id === eventId ? { ...e, scheduled_date: newDate } : e,
        ),
      );
      try {
        await contentCalendarApi.update(eventId, { scheduled_date: newDate });
      } catch (err) {
        // rollback
        setEvents((prev) =>
          prev.map((e) =>
            e.id === eventId
              ? { ...e, scheduled_date: original.scheduled_date }
              : e,
          ),
        );
        setError(err instanceof Error ? err.message : t('rescheduleError'));
      }
    },
    [events, t],
  );

  const onAIGenerated = useCallback(
    (newEvents: ContentCalendarEvent[]) => {
      setEvents((prev) => [...prev, ...newEvents]);
    },
    [],
  );

  const toggleChannel = useCallback((c: ContentChannel) => {
    setChannelFilter((prev) =>
      prev.length === 0
        ? [c]
        : prev.includes(c)
          ? prev.filter((x) => x !== c)
          : [...prev, c],
    );
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div>
          <h1 className="text-lg font-bold">{t('title')}</h1>
          <p className="text-xs text-muted-foreground">
            {t('subtitle', {
              from: addDaysIsoDate(range.from, 0),
              to: addDaysIsoDate(range.to, 0),
            })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setAiOpen(true)}
            className="flex min-h-[36px] items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-3 py-1.5 text-xs font-medium text-cyan-300 hover:bg-cyan-500/20"
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t('generateWithAi')}
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="flex min-h-[36px] items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-cyan-400"
          >
            <Plus className="h-3.5 w-3.5" /> {t('newEvent')}
          </button>
        </div>
      </header>

      {/* Filtros + view toggle */}
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2.5 sm:px-6">
        <div className="flex items-center gap-1 rounded-md border border-border p-0.5">
          <ViewToggle
            active={view === 'month'}
            onClick={() => setView('month')}
            icon={<Layers className="h-3.5 w-3.5" />}
            label={t('view.month')}
          />
          <ViewToggle
            active={view === 'week'}
            onClick={() => setView('week')}
            icon={<CalendarDays className="h-3.5 w-3.5" />}
            label={t('view.week')}
          />
          <ViewToggle
            active={view === 'list'}
            onClick={() => setView('list')}
            icon={<List className="h-3.5 w-3.5" />}
            label={t('view.list')}
          />
        </div>

        <ChannelColorLegend
          selected={channelFilter.length === 0 ? undefined : channelFilter}
          onToggle={toggleChannel}
        />

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as ContentStatus | 'all')}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-xs"
        >
          <option value="all">{t('filter.allStatus')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 text-xs">
          <input
            type="checkbox"
            checked={productLinkedOnly}
            onChange={(e) => setProductLinkedOnly(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          {t('filter.productLinkedOnly')}
        </label>

        {channelFilter.length > 0 && (
          <button
            type="button"
            onClick={() => setChannelFilter([])}
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            {t('filter.clearChannels')}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        {loading ? (
          <p className="text-xs text-muted-foreground">{t('loading')}</p>
        ) : error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <>
            {view === 'month' && (
              <CalendarMonthView
                events={filtered}
                onEventClick={onEventClick}
                onReschedule={onReschedule}
              />
            )}
            {view === 'week' && (
              <CalendarWeekView
                events={filtered}
                onEventClick={onEventClick}
                onReschedule={onReschedule}
              />
            )}
            {view === 'list' && (
              <CalendarListView
                events={filtered}
                onEventClick={onEventClick}
              />
            )}
          </>
        )}
      </div>

      <EventDrawer
        open={drawerOpen}
        event={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={onSaved}
        onDeleted={onDeleted}
      />
      <AIPlanGenerator
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        onGenerated={onAIGenerated}
      />
    </div>
  );
}

function ViewToggle({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[36px] items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors',
        active
          ? 'bg-cyan-500/15 text-cyan-300'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {icon}
      {label}
    </button>
  );
}
