'use client';

import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ContentCalendarEvent } from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';
import { EventCard } from './event-card';
import {
  buildWeekDays,
  formatDateKey,
  formatLongDate,
  isSameDay,
  shiftDays,
} from './calendar-utils';

interface CalendarWeekViewProps {
  events: ContentCalendarEvent[];
  onEventClick: (event: ContentCalendarEvent) => void;
  onReschedule?: (eventId: string, newDate: string) => void | Promise<void>;
  className?: string;
}

const HOURS = [
  '06:00',
  '08:00',
  '10:00',
  '12:00',
  '14:00',
  '16:00',
  '18:00',
  '20:00',
  '22:00',
];

const WEEKDAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/**
 * Vista semanal: 7 colunas × bands de horas. Eventos posicionados pelo
 * `scheduled_time`; eventos sem hora caem na band "Sem hora" no topo.
 * Drag-and-drop nativo (ondrop por célula).
 */
export function CalendarWeekView({
  events,
  onEventClick,
  onReschedule,
  className,
}: CalendarWeekViewProps) {
  const t = useTranslations('contentCalendar');
  const [cursor, setCursor] = useState(() => new Date());
  const [dragOverCell, setDragOverCell] = useState<string | null>(null);

  const weekDays = useMemo(() => buildWeekDays(cursor), [cursor]);

  // Indexa eventos por (dateKey, hourBand)
  const grid = useMemo(() => {
    const map = new Map<string, ContentCalendarEvent[]>();
    for (const e of events) {
      const dateKey = e.scheduled_date;
      const band = e.scheduled_time
        ? closestBand(e.scheduled_time)
        : 'no-time';
      const key = `${dateKey}|${band}`;
      const arr = map.get(key) ?? [];
      arr.push(e);
      map.set(key, arr);
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

  function handleDrop(
    ev: React.DragEvent<HTMLDivElement>,
    dateKey: string,
  ) {
    ev.preventDefault();
    setDragOverCell(null);
    const id = ev.dataTransfer.getData('text/x-event-id');
    if (id && onReschedule) void onReschedule(id, dateKey);
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold">
          {t('weekRange', {
            fromDay: weekDays[0]?.getDate() ?? 0,
            fromMonth: (weekDays[0]?.getMonth() ?? 0) + 1,
            toDay: weekDays[6]?.getDate() ?? 0,
            toMonth: (weekDays[6]?.getMonth() ?? 0) + 1,
          })}
        </h3>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor((d) => shiftDays(d, -7))}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            aria-label={t('prevWeek')}
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
            onClick={() => setCursor((d) => shiftDays(d, 7))}
            className="flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-accent"
            aria-label={t('nextWeek')}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabela horizontal scrollável (mobile-friendly) */}
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          {/* Header com dias */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-1">
            <div />
            {weekDays.map((d) => {
              const isTodayCell = isSameDay(d, today);
              return (
                <div
                  key={formatDateKey(d)}
                  className={cn(
                    'rounded-md border px-2 py-1.5 text-center text-xs',
                    isTodayCell
                      ? 'border-cyan-400/40 bg-cyan-500/10 text-cyan-300 font-bold'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  <div className="text-[10px] uppercase">{t(`weekdayShort.${WEEKDAY_KEYS[d.getDay()]}`)}</div>
                  <div className="text-base">{d.getDate()}</div>
                </div>
              );
            })}
          </div>

          {/* Linha "sem hora" */}
          <Row
            label={t('weekNoTimeLabel')}
            band="no-time"
            weekDays={weekDays}
            grid={grid}
            dragOverCell={dragOverCell}
            today={today}
            onEventClick={onEventClick}
            onReschedule={onReschedule}
            onDragStart={handleDragStart}
            onDragOver={(key) => setDragOverCell(key)}
            onDragLeave={() => setDragOverCell(null)}
            onDrop={handleDrop}
          />

          {/* Bands de hora */}
          {HOURS.map((h) => (
            <Row
              key={h}
              label={h}
              band={h}
              weekDays={weekDays}
              grid={grid}
              dragOverCell={dragOverCell}
              today={today}
              onEventClick={onEventClick}
              onReschedule={onReschedule}
              onDragStart={handleDragStart}
              onDragOver={(key) => setDragOverCell(key)}
              onDragLeave={() => setDragOverCell(null)}
              onDrop={handleDrop}
            />
          ))}
        </div>
      </div>

      {/* Hint mobile */}
      <p className="text-[11px] text-muted-foreground md:hidden">
        {t('weekHint')}
      </p>
      <p className="sr-only">
        {weekDays[0] && formatLongDate(weekDays[0], (k, v) => t(k, v))}
      </p>
    </div>
  );
}

interface RowProps {
  label: string;
  band: string;
  weekDays: Date[];
  grid: Map<string, ContentCalendarEvent[]>;
  dragOverCell: string | null;
  today: Date;
  onEventClick: (event: ContentCalendarEvent) => void;
  onReschedule?: (eventId: string, newDate: string) => void | Promise<void>;
  onDragStart: (
    ev: React.DragEvent<HTMLDivElement>,
    eventId: string,
  ) => void;
  onDragOver: (cellKey: string) => void;
  onDragLeave: () => void;
  onDrop: (ev: React.DragEvent<HTMLDivElement>, dateKey: string) => void;
}

function Row({
  label,
  band,
  weekDays,
  grid,
  dragOverCell,
  today,
  onEventClick,
  onReschedule,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: RowProps) {
  return (
    <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-1 mt-1">
      <div className="flex items-start justify-end pr-2 pt-1 text-[10px] text-muted-foreground">
        {label}
      </div>
      {weekDays.map((d) => {
        const dateKey = formatDateKey(d);
        const cellKey = `${dateKey}|${band}`;
        const cellEvents = grid.get(cellKey) ?? [];
        const isTodayCell = isSameDay(d, today);
        const isDragOver = dragOverCell === cellKey;
        return (
          <div
            key={cellKey}
            onDragOver={(e) => {
              if (!onReschedule) return;
              e.preventDefault();
              onDragOver(cellKey);
            }}
            onDragLeave={onDragLeave}
            onDrop={(e) => onDrop(e, dateKey)}
            className={cn(
              'min-h-[40px] rounded-md border p-1 transition-colors',
              isTodayCell
                ? 'border-cyan-400/20 bg-cyan-500/5'
                : 'border-border bg-card/20',
              isDragOver && 'border-cyan-400/60 bg-cyan-500/10',
            )}
          >
            <div className="flex flex-col gap-1">
              {cellEvents.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  compact
                  isToday={isTodayCell}
                  onClick={() => onEventClick(e)}
                  draggable={!!onReschedule}
                  onDragStart={(ev) => onDragStart(ev, e.id)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Mapeia "HH:MM:SS" pro band mais próximo (das HOURS). */
function closestBand(time: string): string {
  const m = time.slice(0, 5);
  const [h] = m.split(':').map(Number);
  const hourNum = h ?? 12;
  let best = HOURS[0]!;
  let bestDiff = Infinity;
  for (const band of HOURS) {
    const bh = Number(band.split(':')[0] ?? 12);
    const diff = Math.abs(bh - hourNum);
    if (diff < bestDiff) {
      best = band;
      bestDiff = diff;
    }
  }
  return best;
}
