'use client';

import { useEffect, useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { useTranslations } from 'next-intl';
import type { CalendarTask } from '@/lib/api/tasks';
import { cn } from '@/lib/utils';
import {
  HOUR_HEIGHT_PX,
  HOUR_RANGE,
  HOURS_VISIBLE,
  addDays,
  hourSlotTop,
  isSameDay,
  startOfWeek,
  toDateKey,
} from './calendar-utils';
import { TaskBlock } from './task-block';

interface WeekViewProps {
  current: Date;
  tasksByDate: Map<string, CalendarTask[]>;
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnSlot: (date: Date) => void;
}

const ALL_DAY_AREA_HEIGHT = 56;

export function WeekView({
  current,
  tasksByDate,
  onSelectTask,
  onCreateOnSlot,
}: WeekViewProps) {
  const t = useTranslations('calendario');
  const days = useMemo(() => {
    const start = startOfWeek(current);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [current]);

  const today = new Date();

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header da semana */}
      <div className="flex border-b border-border bg-muted/30">
        <div className="w-12 shrink-0" /> {/* gutter da hora */}
        <div className="grid flex-1 grid-cols-7">
          {days.map((d) => {
            const isToday = isSameDay(d, today);
            return (
              <div
                key={toDateKey(d)}
                className={cn(
                  'flex flex-col items-center gap-0.5 border-l border-border px-2 py-2 text-center',
                  isToday && 'bg-primary/5',
                )}
              >
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t(`weekdayShort.${WEEKDAY_KEYS[d.getDay() === 0 ? 6 : d.getDay() - 1]}`)}
                </span>
                <span
                  className={cn(
                    'flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                    isToday && 'bg-primary text-primary-foreground',
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        <div className="flex">
          {/* Coluna de horas */}
          <div className="w-12 shrink-0">
            {/* All-day spacer */}
            <div
              className="border-b border-border"
              style={{ height: `${ALL_DAY_AREA_HEIGHT}px` }}
            />
            {Array.from({ length: HOURS_VISIBLE }).map((_, i) => {
              const hour = HOUR_RANGE.start + i;
              return (
                <div
                  key={hour}
                  className="flex items-start justify-end pr-1.5 text-[10px] text-muted-foreground"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>
              );
            })}
          </div>

          {/* 7 colunas de dia */}
          <div className="grid flex-1 grid-cols-7">
            {days.map((d) => (
              <DayColumn
                key={toDateKey(d)}
                date={d}
                tasks={tasksByDate.get(toDateKey(d)) ?? []}
                isToday={isSameDay(d, today)}
                onSelectTask={onSelectTask}
                onCreateOnSlot={onCreateOnSlot}
                createAtLabel={(hour) => t('weekView.createAt', { hour: String(hour).padStart(2, '0') })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

interface DayColumnProps {
  date: Date;
  tasks: CalendarTask[];
  isToday: boolean;
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnSlot: (date: Date) => void;
  createAtLabel: (hour: number) => string;
}

function DayColumn({
  date,
  tasks,
  isToday,
  onSelectTask,
  onCreateOnSlot,
  createAtLabel,
}: DayColumnProps) {
  const dateKey = toDateKey(date);
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dateKey}`,
    data: { type: 'day', dateKey },
  });

  // Separa tasks com hora vs all-day
  const timed: CalendarTask[] = [];
  const allDay: CalendarTask[] = [];
  for (const t of tasks) {
    const d = new Date(t.due_date);
    const h = d.getHours();
    if (h >= HOUR_RANGE.start && h < HOUR_RANGE.end) {
      timed.push(t);
    } else {
      allDay.push(t);
    }
  }

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative border-l border-border',
        isToday && 'bg-primary/5',
        isOver && 'bg-primary/10',
      )}
    >
      {/* Faixa all-day */}
      <div
        className="relative border-b border-border bg-muted/20 px-1 py-1"
        style={{ height: `${ALL_DAY_AREA_HEIGHT}px` }}
      >
        <div className="flex flex-col gap-0.5">
          {allDay.slice(0, 2).map((t) => (
            <CompactPill
              key={t.id}
              task={t}
              onClick={(e) => onSelectTask(t, { x: e.clientX, y: e.clientY })}
            />
          ))}
          {allDay.length > 2 && (
            <span className="px-1 text-[9px] text-muted-foreground">
              +{allDay.length - 2}
            </span>
          )}
        </div>
      </div>

      {/* Grid de horas com background */}
      <div className="relative">
        {Array.from({ length: HOURS_VISIBLE }).map((_, i) => (
          <button
            type="button"
            key={i}
            onClick={() => {
              const slot = new Date(date);
              slot.setHours(HOUR_RANGE.start + i, 0, 0, 0);
              onCreateOnSlot(slot);
            }}
            className="block w-full border-b border-border/60 transition-colors hover:bg-muted/30"
            style={{ height: `${HOUR_HEIGHT_PX}px` }}
            aria-label={createAtLabel(HOUR_RANGE.start + i)}
          />
        ))}

        {/* Linha do horário atual */}
        {isToday && <NowLine />}

        {/* Blocos posicionados */}
        {timed.map((t) => (
          <TaskBlock
            key={t.id}
            task={t}
            draggableId={`block-w:${t.id}`}
            variant="week"
            top={hourSlotTop(t.due_date)}
            height={HOUR_HEIGHT_PX - 4}
            onClick={(e) => onSelectTask(t, { x: e.clientX, y: e.clientY })}
          />
        ))}
      </div>
    </div>
  );
}

function CompactPill({
  task,
  onClick,
}: {
  task: CalendarTask;
  onClick: (e: React.MouseEvent) => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className="truncate rounded bg-muted px-1.5 py-0.5 text-left text-[10px] font-medium hover:bg-muted/70"
    >
      {task.title}
    </button>
  );
}

function NowLine() {
  const [top, setTop] = useState<number | null>(null);
  useEffect(() => {
    function update() {
      const now = new Date();
      const h = now.getHours();
      const m = now.getMinutes();
      if (h < HOUR_RANGE.start || h >= HOUR_RANGE.end) {
        setTop(null);
        return;
      }
      setTop((h - HOUR_RANGE.start) * HOUR_HEIGHT_PX + (m / 60) * HOUR_HEIGHT_PX);
    }
    update();
    const id = setInterval(update, 60_000);
    return () => clearInterval(id);
  }, []);
  if (top === null) return null;
  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-10 h-px bg-red-500"
      style={{ top: `${top}px` }}
    >
      <div className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
    </div>
  );
}

const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
