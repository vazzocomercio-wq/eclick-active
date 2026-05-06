'use client';

import { useMemo } from 'react';
import { CalendarRange } from 'lucide-react';
import type { ContentCalendarEvent } from '@/lib/api/content-calendar';
import { cn } from '@/lib/utils';
import { EventCard } from './event-card';
import { formatLongDate, isSameDay } from './calendar-utils';

interface CalendarListViewProps {
  events: ContentCalendarEvent[];
  onEventClick: (event: ContentCalendarEvent) => void;
  className?: string;
}

/**
 * Lista cronológica agrupada por dia. Mobile-first — funciona bem em
 * qualquer viewport, sem scroll horizontal.
 */
export function CalendarListView({
  events,
  onEventClick,
  className,
}: CalendarListViewProps) {
  const groups = useMemo(() => {
    const map = new Map<string, ContentCalendarEvent[]>();
    for (const e of events) {
      const arr = map.get(e.scheduled_date) ?? [];
      arr.push(e);
      map.set(e.scheduled_date, arr);
    }
    // sort por scheduled_time dentro de cada dia
    for (const arr of map.values()) {
      arr.sort((a, b) =>
        (a.scheduled_time ?? '99').localeCompare(b.scheduled_time ?? '99'),
      );
    }
    // retorna entries ordenadas por data
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events]);

  if (groups.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border py-10 text-center',
          className,
        )}
      >
        <CalendarRange className="h-8 w-8 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Nenhum evento no período.</p>
          <p className="text-xs text-muted-foreground">
            Crie um manualmente ou peça à IA pra gerar um plano.
          </p>
        </div>
      </div>
    );
  }

  const today = new Date();

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {groups.map(([dateKey, dayEvents]) => {
        const date = new Date(dateKey + 'T00:00:00');
        const isToday = isSameDay(date, today);
        return (
          <section key={dateKey}>
            <h4
              className={cn(
                'mb-1.5 flex items-center gap-2 border-b border-border pb-1 text-xs font-semibold capitalize',
                isToday && 'border-cyan-400/40 text-cyan-300',
              )}
            >
              {formatLongDate(date)}
              {isToday && (
                <span className="rounded-full bg-cyan-500/20 px-2 py-0 text-[10px] font-medium uppercase tracking-wide">
                  Hoje
                </span>
              )}
            </h4>
            <div className="flex flex-col gap-1.5">
              {dayEvents.map((e) => (
                <EventCard
                  key={e.id}
                  event={e}
                  isToday={isToday}
                  onClick={() => onEventClick(e)}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
