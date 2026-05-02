'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import type { TaskType } from '@eclick-active/shared';
import { toast } from 'sonner';
import {
  type CalendarDay,
  type CalendarTask,
  type CalendarTasksParams,
  tasksApi,
} from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { NewTaskDialog } from '@/components/tarefas/new-task-dialog';
import { CalendarHeader } from './calendar-header';
import { DayView } from './day-view';
import { MonthView } from './month-view';
import { WeekView } from './week-view';
import { TaskPopover } from './task-popover';
import {
  type CalendarViewMode,
  addDays,
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  monthGridRange,
  startOfDay,
  startOfMonth,
  startOfWeek,
  toDateKey,
} from './calendar-utils';

const ACTIVE_SCHEMA = 'active';

export function CalendarPage() {
  const [view, setView] = useState<CalendarViewMode>('week');
  const [current, setCurrent] = useState<Date>(() => new Date());
  const [onlyMine, setOnlyMine] = useState(true);
  const [selectedTypes, setSelectedTypes] = useState<TaskType[]>([]);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Popover state
  const [popoverTask, setPopoverTask] = useState<CalendarTask | null>(null);
  const [popoverAnchor, setPopoverAnchor] = useState<{ x: number; y: number } | null>(null);

  // NewTaskDialog state
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  const [prefilledDate, setPrefilledDate] = useState<{ date?: string; time?: string }>({});

  // Detecta mobile (apenas Dia)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Em mobile, força visão Dia
  useEffect(() => {
    if (isMobile && view !== 'day') {
      setView('day');
    }
  }, [isMobile, view]);

  // Carrega user atual
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setCurrentUserId(data.user.id);
    });
  }, []);

  // Range de carregamento depende da view
  const range = useMemo(() => {
    if (view === 'month') {
      const { from, to } = monthGridRange(current);
      return { from, to };
    }
    if (view === 'week') {
      return { from: startOfWeek(current), to: endOfWeek(current) };
    }
    return { from: startOfDay(current), to: endOfDay(current) };
  }, [view, current]);

  // Params da query
  const params = useMemo<CalendarTasksParams>(() => {
    const p: CalendarTasksParams = {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    };
    if (onlyMine && currentUserId) p.user_id = currentUserId;
    if (selectedTypes.length > 0) p.task_type = selectedTypes;
    return p;
  }, [range, onlyMine, currentUserId, selectedTypes]);

  // Fetch
  const fetchOnce = useCallback(
    async (signal?: AbortSignal) => {
      setError(null);
      try {
        const result = await tasksApi.calendar(params, signal);
        setDays(result);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        const msg =
          err instanceof ApiError
            ? `${err.status}: ${err.message}`
            : err instanceof Error
              ? err.message
              : 'Erro ao carregar calendário';
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [params],
  );

  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    void fetchOnce(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchOnce]);

  const refetch = useCallback(() => {
    void fetchOnce();
  }, [fetchOnce]);

  // Realtime — debounced refetch
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    const trigger = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        void fetchOnce();
      }, 250);
    };
    const channel = supabase
      .channel('calendar-tasks')
      .on(
        'postgres_changes',
        { event: '*', schema: ACTIVE_SCHEMA, table: 'tasks' },
        trigger,
      )
      .subscribe();
    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchOnce]);

  // Index de tasks por data
  const tasksByDate = useMemo(() => {
    const m = new Map<string, CalendarTask[]>();
    for (const day of days) {
      m.set(day.date, day.tasks);
    }
    return m;
  }, [days]);

  // Tasks do dia atual (visão Day)
  const todayTasks = useMemo(() => {
    return tasksByDate.get(toDateKey(current)) ?? [];
  }, [tasksByDate, current]);

  // ──────────────────────────────────────────────
  // Navegação de período
  // ──────────────────────────────────────────────

  const handlePrev = useCallback(() => {
    setCurrent((c) => {
      if (view === 'month') return startOfMonth(addMonths(c, -1));
      if (view === 'week') return addDays(c, -7);
      return addDays(c, -1);
    });
  }, [view]);

  const handleNext = useCallback(() => {
    setCurrent((c) => {
      if (view === 'month') return startOfMonth(addMonths(c, 1));
      if (view === 'week') return addDays(c, 7);
      return addDays(c, 1);
    });
  }, [view]);

  const handleToday = useCallback(() => setCurrent(new Date()), []);

  // ──────────────────────────────────────────────
  // Filtros
  // ──────────────────────────────────────────────

  const handleToggleType = useCallback((t: TaskType) => {
    setSelectedTypes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t],
    );
  }, []);

  const handleClearTypes = useCallback(() => setSelectedTypes([]), []);

  // ──────────────────────────────────────────────
  // Criação inline
  // ──────────────────────────────────────────────

  const handleCreateOnDate = useCallback((d: Date) => {
    setPrefilledDate({ date: toDateKey(d) });
    setNewDialogOpen(true);
  }, []);

  const handleCreateOnSlot = useCallback((d: Date) => {
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    setPrefilledDate({ date: toDateKey(d), time: `${hh}:${mm}` });
    setNewDialogOpen(true);
  }, []);

  // ──────────────────────────────────────────────
  // Popover detalhes
  // ──────────────────────────────────────────────

  const handleSelectTask = useCallback(
    (task: CalendarTask, anchor: { x: number; y: number }) => {
      setPopoverTask(task);
      setPopoverAnchor(anchor);
    },
    [],
  );

  const closePopover = useCallback(() => {
    setPopoverTask(null);
    setPopoverAnchor(null);
  }, []);

  // ──────────────────────────────────────────────
  // Drag-and-drop — reagendar via PATCH due_date
  // ──────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      const taskId = (e.active.data.current as { taskId?: string })?.taskId;
      const oldIso = (e.active.data.current as { dueDate?: string })?.dueDate;
      const dropData = e.over?.data.current as { type?: string; dateKey?: string } | undefined;
      if (!taskId || !dropData || dropData.type !== 'day' || !dropData.dateKey) return;
      if (!oldIso) return;

      const old = new Date(oldIso);
      const [yyyy, mm, dd] = dropData.dateKey.split('-').map(Number);
      if (!yyyy || !mm || !dd) return;
      const newDate = new Date(yyyy, mm - 1, dd, old.getHours(), old.getMinutes(), 0, 0);

      // Se já é a mesma data, ignora
      if (
        newDate.getFullYear() === old.getFullYear() &&
        newDate.getMonth() === old.getMonth() &&
        newDate.getDate() === old.getDate()
      ) {
        return;
      }

      // Otimista: move local primeiro
      const previousDays = days;
      const oldKey = toDateKey(old);
      const newKey = dropData.dateKey;
      setDays((prev) => moveTaskLocally(prev, taskId, oldKey, newKey, newDate.toISOString()));

      try {
        await tasksApi.update(taskId, { due_date: newDate.toISOString() });
        toast.success('Tarefa reagendada');
      } catch (err) {
        // Reverte
        setDays(previousDays);
        const msg =
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : 'Erro ao reagendar';
        toast.error(msg);
      }
    },
    [days],
  );

  // ──────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <CalendarHeader
        view={view}
        current={current}
        onlyMine={onlyMine}
        selectedTypes={selectedTypes}
        onChangeView={setView}
        onPrev={handlePrev}
        onNext={handleNext}
        onToday={handleToday}
        onChangeMine={setOnlyMine}
        onToggleType={handleToggleType}
        onClearTypes={handleClearTypes}
        onNewTask={() => {
          setPrefilledDate({});
          setNewDialogOpen(true);
        }}
        loading={loading}
      />

      {error && (
        <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div
        className="flex-1 overflow-hidden"
        onTouchStart={isMobile ? (e) => handleTouchStart(e, touchStartRef) : undefined}
        onTouchEnd={
          isMobile
            ? (e) => handleTouchEnd(e, touchStartRef, handlePrev, handleNext)
            : undefined
        }
      >
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          {view === 'month' && !isMobile && (
            <MonthView
              current={current}
              tasksByDate={tasksByDate}
              onSelectTask={handleSelectTask}
              onCreateOnDate={handleCreateOnDate}
            />
          )}
          {view === 'week' && !isMobile && (
            <WeekView
              current={current}
              tasksByDate={tasksByDate}
              onSelectTask={handleSelectTask}
              onCreateOnSlot={handleCreateOnSlot}
            />
          )}
          {(view === 'day' || isMobile) && (
            <DayView
              current={current}
              tasks={todayTasks}
              onSelectTask={handleSelectTask}
              onCreateOnSlot={handleCreateOnSlot}
              onChanged={refetch}
            />
          )}
        </DndContext>
      </div>

      {popoverTask && popoverAnchor && (
        <TaskPopover
          task={popoverTask}
          anchor={popoverAnchor}
          onClose={closePopover}
          onChanged={() => {
            refetch();
            closePopover();
          }}
        />
      )}

      <NewTaskDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        defaultDueDate={prefilledDate.date}
        defaultDueTime={prefilledDate.time}
        onCreated={refetch}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Otimista — move task no estado local
// ──────────────────────────────────────────────────────────

function moveTaskLocally(
  days: CalendarDay[],
  taskId: string,
  oldKey: string,
  newKey: string,
  newDueDate: string,
): CalendarDay[] {
  let moved: CalendarTask | null = null;

  // Remove do dia antigo
  const without = days.map((d) => {
    if (d.date !== oldKey) return d;
    const filtered = d.tasks.filter((t) => {
      if (t.id === taskId) {
        moved = { ...t, due_date: newDueDate };
        return false;
      }
      return true;
    });
    return { ...d, tasks: filtered };
  });

  if (!moved) return days;

  // Adiciona no dia novo (ou cria entry)
  const existing = without.find((d) => d.date === newKey);
  if (existing) {
    return without.map((d) =>
      d.date === newKey ? { ...d, tasks: [...d.tasks, moved as CalendarTask] } : d,
    );
  }
  return [...without, { date: newKey, tasks: [moved] }].sort((a, b) =>
    a.date.localeCompare(b.date),
  );
}

// ──────────────────────────────────────────────────────────
// Mobile swipe handlers
// ──────────────────────────────────────────────────────────

const touchStartRef: { current: { x: number; y: number; t: number } | null } = {
  current: null,
};

function handleTouchStart(
  e: React.TouchEvent,
  ref: typeof touchStartRef,
): void {
  const t = e.touches[0];
  if (!t) return;
  ref.current = { x: t.clientX, y: t.clientY, t: Date.now() };
}

function handleTouchEnd(
  e: React.TouchEvent,
  ref: typeof touchStartRef,
  onPrev: () => void,
  onNext: () => void,
): void {
  const start = ref.current;
  if (!start) return;
  ref.current = null;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - start.x;
  const dy = t.clientY - start.y;
  const dt = Date.now() - start.t;
  // Threshold: 60px horizontal, predominantemente horizontal, < 600ms
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5 || dt > 600) return;
  if (dx > 0) onPrev();
  else onNext();
}
