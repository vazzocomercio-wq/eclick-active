'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ContentCalendarEvent } from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';
import { EventCard } from './event-card';
import {
  buildMonthGrid,
  formatDateKey,
  formatMonthYear,
  isSameDay,
  shiftMonth,
} from './calendar-utils';

interface CalendarMonthViewProps {
  events: ContentCalendarEvent[];
  onEventClick: (event: ContentCalendarEvent) => void;
  /**
   * Drag-and-drop: chamado quando um evento é solto numa nova data.
   * Implementação concreta vem do hook `useDragDropReschedule`.
   */
  onReschedule?: (eventId: string, newDate: string) => void | Promise<void>;
  /** Mobile alternativo: long-press → bottom-sheet — exposto via callback. */
  onLongPressEvent?: (event: ContentCalendarEvent) => void;
  className?: string;
}

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Grade 7×N do mês (desktop) ou stack vertical de dias com eventos (mobile).
 * Drag-and-drop nativo HTML5 — leve, suficiente pra MVP.
 */
export function CalendarMonthView({
  events,
  onEventClick,
  onReschedule,
  onLongPressEvent,
  className,
}: CalendarMonthViewProps) {
  const t = useTranslations('contentCalendar');
  const [cursor, setCursor] = useState(() => new Date());
  const [dragOverDay, setDragOverDay] = useState<string | null>(null);

  const grid = useMemo(() => buildMonthGrid(cursor), [cursor]);

  // Indexa eventos por dia (YYYY-MM-DD) pra lookup O(1)
  const byDate = useMemo(() => {
    const map = new Map<string, ContentCalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.scheduled_date) ?? [];
      arr.push(e);
      map.set(e.scheduled_date, arr);
    }
    return map;
  }, [events]);

  const today = new Date();

  function handleDragStart(
    ev: React.DragEvent<HTMLDivElement>,
    eventId: string,
  ) {
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/x-event-id', eventId);
  }

  function handleDrop(ev: React.DragEvent<HTMLDivElement>, dateKey: string) {
    ev.preventDefault();
    setDragOverDay(null);
    const id = ev.dataTransfer.getData('text/x-event-id');
    if (id && onReschedule) void onReschedule(id, dateKey);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header com navegação */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold capitalize">
          {formatMonthYear(cursor, (k, v) => t(k, v))}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((d) => shiftMonth(d, -1))}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            aria-label={t('prevMonth')}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setCursor(new Date())}
            className="rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
          >
            {t('today')}
          </button>
          <button
            type="button"
            onClick={() => setCursor((d) => shiftMonth(d, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            aria-label={t('nextMonth')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grade desktop / stack mobile */}
      <div className="hidden md:block">
        {/* Cabeçalho dos dias da semana */}
        <div className="grid grid-cols-7 gap-1 pb-1">
          {WEEKDAY_KEYS.map((key) => (
            <div
              key={key}
              className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {t(`weekdayShort.${key}`)}
            </div>
          ))}
        </div>
        {/* Grade */}
        <div className="grid grid-cols-7 gap-1">
          {grid.map((day) => {
            const dateKey = formatDateKey(day.date);
            const dayEvents = byDate.get(dateKey) ?? [];
            const isCurrentMonth = day.inMonth;
            const isTodayCell = isSameDay(day.date, today);
            const isDragOver = dragOverDay === dateKey;

            return (
              <div
                key={dateKey}
                onDragOver={(e) => {
                  if (!onReschedule) return;
                  e.preventDefault();
                  setDragOverDay(dateKey);
                }}
                onDragLeave={() => setDragOverDay(null)}
                onDrop={(e) => handleDrop(e, dateKey)}
                className={cn(
                  'flex min-h-[92px] flex-col gap-1 rounded-md border p-1.5 transition-colors',
                  isCurrentMonth
                    ? 'border-border bg-card/30'
                    : 'border-transparent bg-card/10 opacity-50',
                  isTodayCell && 'ring-1 ring-cyan-400/50',
                  isDragOver && 'bg-cyan-500/10 border-cyan-400/60',
                )}
              >
                <div
                  className={cn(
                    'flex items-center justify-between text-[11px]',
                    isTodayCell
                      ? 'font-bold text-cyan-300'
                      : 'text-muted-foreground',
                  )}
                >
                  <span>{day.date.getDate()}</span>
                  {dayEvents.length > 3 && (
                    <span className="rounded-full bg-cyan-500/20 px-1.5 py-0 text-[9px] font-medium text-cyan-300">
                      +{dayEvents.length - 3}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1">
                  {dayEvents.slice(0, 3).map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      compact
                      isToday={isTodayCell}
                      onClick={() => onEventClick(e)}
                      draggable={!!onReschedule}
                      onDragStart={(ev) => handleDragStart(ev, e.id)}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Mobile: stack vertical de dias com eventos */}
      <div className="block space-y-3 md:hidden">
        {grid
          .filter((d) => d.inMonth)
          .map((day) => {
            const dateKey = formatDateKey(day.date);
            const dayEvents = byDate.get(dateKey) ?? [];
            if (dayEvents.length === 0) return null;
            const isTodayCell = isSameDay(day.date, today);
            return (
              <div key={dateKey}>
                <div
                  className={cn(
                    'mb-1.5 flex items-baseline gap-2 border-b border-border pb-1',
                    isTodayCell && 'border-cyan-400/40',
                  )}
                >
                  <span
                    className={cn(
                      'text-lg font-bold tabular-nums',
                      isTodayCell ? 'text-cyan-300' : 'text-foreground',
                    )}
                  >
                    {day.date.getDate()}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`weekdayShort.${WEEKDAY_KEYS[day.date.getDay()]}`)}
                  </span>
                  {isTodayCell && (
                    <span className="ml-auto rounded-full bg-cyan-500/20 px-2 py-0.5 text-[10px] font-medium text-cyan-300">
                      {t('today')}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  {dayEvents.map((e) => (
                    <EventCard
                      key={e.id}
                      event={e}
                      isToday={isTodayCell}
                      onClick={() => {
                        if (onLongPressEvent) {
                          // Em mobile mantém click padrão; long-press é handled pelo container pai
                        }
                        onEventClick(e);
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })}
      </div>
    </div>
  );
}
