'use client';

import { useEffect, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { Check, Loader2 } from 'lucide-react';
import type { CalendarTask } from '@/lib/api/tasks';
import { tasksApi } from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  PriorityBadge,
  TaskTypeIcon,
} from '@/components/tarefas/task-badges';
import {
  HOUR_HEIGHT_PX,
  HOUR_RANGE,
  HOURS_VISIBLE,
  hourSlotTop,
  isSameDay,
  toDateKey,
} from './calendar-utils';
import { TaskBlock } from './task-block';

interface DayViewProps {
  current: Date;
  tasks: CalendarTask[];
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnSlot: (date: Date) => void;
  onChanged: () => void;
}

export function DayView({
  current,
  tasks,
  onSelectTask,
  onCreateOnSlot,
  onChanged,
}: DayViewProps) {
  const today = new Date();
  const isToday = isSameDay(current, today);

  // Separa timed vs all-day
  const timed: CalendarTask[] = [];
  const allDay: CalendarTask[] = [];
  for (const t of tasks) {
    const h = new Date(t.due_date).getHours();
    if (h >= HOUR_RANGE.start && h < HOUR_RANGE.end) {
      timed.push(t);
    } else {
      allDay.push(t);
    }
  }

  return (
    <div className="flex h-full">
      {/* Coluna principal — grid de horas */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* All-day */}
        {allDay.length > 0 && (
          <div className="border-b border-border bg-muted/20 px-4 py-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Dia inteiro
            </span>
            <div className="mt-1 flex flex-wrap gap-1">
              {allDay.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={(e) => onSelectTask(t, { x: e.clientX, y: e.clientY })}
                  className="rounded bg-card px-2 py-0.5 text-xs font-medium hover:bg-muted"
                >
                  {t.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-1 overflow-y-auto">
          {/* Coluna de horas */}
          <div className="w-14 shrink-0">
            {Array.from({ length: HOURS_VISIBLE }).map((_, i) => {
              const hour = HOUR_RANGE.start + i;
              return (
                <div
                  key={hour}
                  className="flex items-start justify-end pr-2 text-[10px] text-muted-foreground"
                  style={{ height: `${HOUR_HEIGHT_PX}px` }}
                >
                  {String(hour).padStart(2, '0')}:00
                </div>
              );
            })}
          </div>

          {/* Coluna do dia */}
          <DayColumn
            current={current}
            timed={timed}
            isToday={isToday}
            onSelectTask={onSelectTask}
            onCreateOnSlot={onCreateOnSlot}
          />
        </div>
      </div>

      {/* Sidebar lista do dia (esconde em mobile) */}
      <aside className="hidden w-72 shrink-0 border-l border-border bg-card md:flex md:flex-col">
        <div className="border-b border-border px-4 py-3">
          <h3 className="text-sm font-semibold">Tarefas de hoje</h3>
          <p className="text-[11px] text-muted-foreground">
            {tasks.length} {tasks.length === 1 ? 'tarefa' : 'tarefas'}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {tasks.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-muted-foreground">
              Nenhuma tarefa neste dia.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {tasks.map((t) => (
                <li key={t.id}>
                  <SidebarTaskItem task={t} onChanged={onChanged} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </div>
  );
}

interface DayColumnProps {
  current: Date;
  timed: CalendarTask[];
  isToday: boolean;
  onSelectTask: (task: CalendarTask, anchor: { x: number; y: number }) => void;
  onCreateOnSlot: (date: Date) => void;
}

function DayColumn({
  current,
  timed,
  isToday,
  onSelectTask,
  onCreateOnSlot,
}: DayColumnProps) {
  const dateKey = toDateKey(current);
  const { setNodeRef, isOver } = useDroppable({
    id: `day:${dateKey}`,
    data: { type: 'day', dateKey },
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative flex-1 border-l border-border',
        isOver && 'bg-primary/10',
      )}
    >
      {Array.from({ length: HOURS_VISIBLE }).map((_, i) => (
        <button
          type="button"
          key={i}
          onClick={() => {
            const slot = new Date(current);
            slot.setHours(HOUR_RANGE.start + i, 0, 0, 0);
            onCreateOnSlot(slot);
          }}
          className="block w-full border-b border-border/60 transition-colors hover:bg-muted/30"
          style={{ height: `${HOUR_HEIGHT_PX}px` }}
          aria-label={`Criar às ${HOUR_RANGE.start + i}:00`}
        />
      ))}

      {isToday && <NowLine />}

      {timed.map((t) => (
        <TaskBlock
          key={t.id}
          task={t}
          draggableId={`block-d:${t.id}`}
          variant="day"
          top={hourSlotTop(t.due_date)}
          height={HOUR_HEIGHT_PX * 1.2}
          onClick={(e) => onSelectTask(t, { x: e.clientX, y: e.clientY })}
        />
      ))}
    </div>
  );
}

function SidebarTaskItem({
  task,
  onChanged,
}: {
  task: CalendarTask;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isCompleted = task.status === 'completed';

  async function handleComplete() {
    if (isCompleted || busy) return;
    setBusy(true);
    setError(null);
    try {
      await tasksApi.complete(task.id);
      onChanged();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao concluir',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-md border border-transparent p-2 transition-colors hover:border-border hover:bg-background',
        isCompleted && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={handleComplete}
        disabled={busy || isCompleted}
        aria-label={isCompleted ? 'Concluída' : 'Concluir'}
        className={cn(
          'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors',
          isCompleted
            ? 'border-emerald-500 bg-emerald-500 text-background'
            : 'border-border hover:border-emerald-500',
        )}
      >
        {busy && !isCompleted ? (
          <Loader2 className="h-2.5 w-2.5 animate-spin" />
        ) : isCompleted ? (
          <Check className="h-2.5 w-2.5 stroke-[3]" />
        ) : null}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <TaskTypeIcon type={task.task_type} className="shrink-0" />
          <span
            className={cn(
              'truncate text-xs font-medium',
              isCompleted && 'line-through',
            )}
          >
            {task.title}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PriorityBadge priority={task.priority} />
          {task.contact_name && (
            <span className="truncate text-[10px] text-muted-foreground">
              · {task.contact_name}
            </span>
          )}
        </div>
        {error && (
          <p className="text-[10px] text-destructive">{error}</p>
        )}
      </div>
    </div>
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
      <span className="absolute -top-2.5 left-2 rounded bg-red-500 px-1 text-[9px] font-medium text-white">
        agora
      </span>
    </div>
  );
}
