'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Calendar, Loader2, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { Task } from '@eclick-active/shared';
import type { TaskRow } from '@/lib/api/tasks';
import { tasksApi } from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import {
  AICreatedBadge,
  PriorityBadge,
  StatusBadge,
  TaskTypeIcon,
} from './task-badges';

interface TaskRowProps {
  task: TaskRow;
  /** Atualiza estado local após complete/delete */
  onLocalPatch: (id: string, patch: Partial<TaskRow>) => void;
  onLocalRemove: (id: string) => void;
}

export function TaskRowItem({ task, onLocalPatch, onLocalRemove }: TaskRowProps) {
  const t = useTranslations('tarefas.row');
  const [busy, setBusy] = useState<'complete' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const overdueState = computeDueState(task.due_date, task.status);
  const isCompleted = task.status === 'completed';

  async function handleComplete() {
    if (isCompleted || busy) return;
    setBusy('complete');
    setError(null);
    // Otimista: marca como concluída imediatamente para a animação rolar
    onLocalPatch(task.id, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    try {
      const updated = await tasksApi.complete(task.id);
      onLocalPatch(task.id, updated as Partial<Task>);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errors.complete'),
      );
      // Reverte
      onLocalPatch(task.id, { status: task.status, completed_at: task.completed_at });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    if (busy) return;
    setBusy('delete');
    setError(null);
    setRemoving(true);
    try {
      await tasksApi.remove(task.id);
      // Aguarda animação antes de remover do DOM
      setTimeout(() => onLocalRemove(task.id), 200);
    } catch (err) {
      setRemoving(false);
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errors.delete'),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className={cn(
        'group flex items-start gap-3 rounded-lg border border-border bg-card p-4 transition-all duration-200',
        'hover:border-primary/30 hover:shadow-sm',
        isCompleted && 'opacity-60',
        removing && 'pointer-events-none scale-[0.98] opacity-0',
      )}
    >
      {/* Checkbox */}
      <button
        type="button"
        onClick={handleComplete}
        disabled={busy !== null || isCompleted}
        aria-label={isCompleted ? t('completedAria') : t('completeAria')}
        className={cn(
          'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
          isCompleted
            ? 'border-emerald-500 bg-emerald-500 text-background'
            : 'border-border hover:border-emerald-500',
        )}
      >
        {busy === 'complete' && !isCompleted ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : isCompleted ? (
          <svg
            className="h-3 w-3 stroke-[3]"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : null}
      </button>

      {/* Body */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-2">
          <TaskTypeIcon type={task.task_type} className="mt-0.5 shrink-0" />
          <span
            className={cn(
              'flex-1 text-sm font-medium leading-tight transition-all',
              isCompleted && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </span>
        </div>

        {task.description && (
          <p className="line-clamp-2 text-xs text-muted-foreground">{task.description}</p>
        )}

        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <PriorityBadge priority={task.priority} />
          {!isCompleted && task.status !== 'pending' && (
            <StatusBadge status={task.status} />
          )}
          {isCompleted && <StatusBadge status={task.status} />}
          {task.created_by_ai && <AICreatedBadge />}

          {task.contact_name && task.contact_id && (
            <Link
              href={`/contatos/${task.contact_id}`}
              className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            >
              {task.contact_name}
            </Link>
          )}

          {task.deal_title && task.deal_id && (
            <Link
              href={`/funis?deal=${task.deal_id}`}
              className="inline-flex items-center rounded-md bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20"
            >
              {task.deal_title}
            </Link>
          )}

          {task.due_date && (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium',
                overdueState === 'overdue' && 'bg-red-500/15 text-red-400',
                overdueState === 'today' && 'bg-yellow-500/15 text-yellow-400',
                overdueState === 'future' && 'bg-muted text-muted-foreground',
              )}
            >
              <Calendar className="h-3 w-3" />
              {formatDueDate(task.due_date, t)}
            </span>
          )}

          {task.assignee_name && (
            <span className="text-[11px] text-muted-foreground">
              · {task.assignee_name}
            </span>
          )}
        </div>

        {error && (
          <p className="text-[11px] text-destructive">{error}</p>
        )}
      </div>

      {/* Actions */}
      <button
        type="button"
        onClick={handleDelete}
        disabled={busy !== null}
        aria-label={t('deleteAria')}
        className="opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        {busy === 'delete' ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

type DueState = 'overdue' | 'today' | 'future' | 'none';

function computeDueState(
  dueDate: string | null,
  status: Task['status'],
): DueState {
  if (!dueDate) return 'none';
  if (status === 'completed' || status === 'cancelled') return 'future';

  const due = new Date(dueDate).getTime();
  if (Number.isNaN(due)) return 'none';
  const now = Date.now();

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);

  if (due < now) return 'overdue';
  if (due >= startOfToday.getTime() && due <= endOfToday.getTime()) return 'today';
  return 'future';
}

function formatDueDate(
  iso: string,
  t: (key: string, vars?: Record<string, string>) => string,
): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return t('dueLabel.noDate');

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setHours(23, 59, 59, 999);

  // Hoje → "Hoje 15:30"
  if (d >= startOfToday && d <= endOfToday) {
    return t('dueLabel.today', { time: d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) });
  }

  // Overdue → "Há 2 dias"
  if (d.getTime() < now.getTime()) {
    return formatRelativeTime(iso);
  }

  // Esta semana
  const sevenDays = 7 * 86_400_000;
  if (d.getTime() - now.getTime() < sevenDays) {
    return d.toLocaleDateString('pt-BR', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // Mais distante
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
