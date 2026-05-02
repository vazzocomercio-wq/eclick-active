'use client';

import { useMemo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import type { CalendarTask } from '@/lib/api/tasks';
import { cn } from '@/lib/utils';
import {
  WEEKDAY_HEADERS,
  addDays,
  isSameDay,
  isSameMonth,
  monthGridRange,
  toDateKey,
} from './calendar-utils';
import { TaskPill } from './task-pill';

interface MonthViewProps {
  current: Date;
  tasksByDate: Map<string, CalendarTask[]>;
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnDate: (date: Date) => void;
}

const MAX_PILLS_PER_DAY = 3;

export function MonthView({
  current,
  tasksByDate,
  onSelectTask,
  onCreateOnDate,
}: MonthViewProps) {
  const days = useMemo(() => {
    const { from, to } = monthGridRange(current);
    const list: Date[] = [];
    let cursor = from;
    while (cursor.getTime() <= to.getTime()) {
      list.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return list;
  }, [current]);

  const today = new Date();
  const now = today.getTime();

  return (
    <div className="flex h-full flex-col">
      {/* Header dos dias da semana */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {WEEKDAY_HEADERS.map((label) => (
          <div key={label} className="px-2 py-1.5 text-center">
            {label}
          </div>
        ))}
      </div>

      {/* Grid de dias — 6 linhas no máximo */}
      <div
        className="grid flex-1 grid-cols-7 gap-px overflow-y-auto bg-border"
        style={{
          gridAutoRows: 'minmax(110px, 1fr)',
        }}
      >
        {days.map((d) => {
          const key = toDateKey(d);
          const tasks = tasksByDate.get(key) ?? [];
          const inCurrentMonth = isSameMonth(d, current);
          const isToday = isSameDay(d, today);
          const hasOverdue = tasks.some(
            (t) =>
              new Date(t.due_date).getTime() < now &&
              t.status !== 'completed' &&
              t.status !== 'cancelled',
          );

          return (
            <DayCell
              key={key}
              date={d}
              dateKey={key}
              tasks={tasks}
              inCurrentMonth={inCurrentMonth}
              isToday={isToday}
              hasOverdue={hasOverdue}
              onSelectTask={onSelectTask}
              onCreateOnDate={onCreateOnDate}
            />
          );
        })}
      </div>
    </div>
  );
}

interface DayCellProps {
  date: Date;
  dateKey: string;
  tasks: CalendarTask[];
  inCurrentMonth: boolean;
  isToday: boolean;
  hasOverdue: boolean;
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnDate: (date: Date) => void;
}

function DayCell({
  date,
  dateKey,
  tasks,
  inCurrentMonth,
  isToday,
  hasOverdue,
  onSelectTask,
  onCreateOnDate,
}: DayCellProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dateKey}`,
    data: { type: 'day', dateKey },
  });

  const visible = tasks.slice(0, MAX_PILLS_PER_DAY);
  const overflow = tasks.length - visible.length;

  return (
    <button
      type="button"
      ref={setNodeRef}
      onClick={() => onCreateOnDate(date)}
      className={cn(
        'group flex flex-col gap-1 bg-background p-1.5 text-left transition-colors',
        !inCurrentMonth && 'bg-muted/30 text-muted-foreground',
        hasOverdue && 'bg-red-500/5',
        isOver && 'bg-primary/10 ring-1 ring-inset ring-primary',
        isToday && 'border-t-2 border-primary',
      )}
      aria-label={`Criar tarefa em ${dateKey}`}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            'flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold',
            isToday && 'bg-primary text-primary-foreground',
          )}
        >
          {date.getDate()}
        </span>
        {tasks.length > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {tasks.length}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((task) => (
          <TaskPill
            key={task.id}
            task={task}
            draggableId={`pill:${task.id}`}
            onClick={(e) => onSelectTask(task, { x: e.clientX, y: e.clientY })}
          />
        ))}
        {overflow > 0 && (
          <span className="px-1 text-[10px] text-muted-foreground">
            +{overflow} mais
          </span>
        )}
      </div>
    </button>
  );
}
