'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, Pencil, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { CalendarTask } from '@/lib/api/tasks';
import { tasksApi } from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import {
  PriorityBadge,
  StatusBadge,
  TaskTypeIcon,
  TaskTypeLabel,
} from '@/components/tarefas/task-badges';
import { cn } from '@/lib/utils';
import { timeLabel } from './calendar-utils';

interface TaskPopoverProps {
  task: CalendarTask;
  /** Coordenada (x, y) onde abrir o popover */
  anchor: { x: number; y: number };
  onClose: () => void;
  onChanged: () => void;
}

export function TaskPopover({ task, anchor, onClose, onChanged }: TaskPopoverProps) {
  const t = useTranslations('calendario');
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<'complete' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Click fora fecha
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function escape(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Em microtask pra não capturar o próprio clique de abertura
    const t = setTimeout(() => document.addEventListener('mousedown', handler), 0);
    document.addEventListener('keydown', escape);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('keydown', escape);
    };
  }, [onClose]);

  // Posicionamento — clamp ao viewport
  const POPOVER_W = 320;
  const POPOVER_H = 240;
  let left = anchor.x;
  let top = anchor.y;
  if (typeof window !== 'undefined') {
    if (left + POPOVER_W > window.innerWidth - 8) left = window.innerWidth - POPOVER_W - 8;
    if (top + POPOVER_H > window.innerHeight - 8) top = window.innerHeight - POPOVER_H - 8;
    if (left < 8) left = 8;
    if (top < 8) top = 8;
  }

  const isCompleted = task.status === 'completed';

  async function handleComplete() {
    if (isCompleted || busy) return;
    setBusy('complete');
    setError(null);
    try {
      await tasksApi.complete(task.id);
      onChanged();
      onClose();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('popover.completeError'),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={t('popover.detailsOf', { title: task.title })}
      className="fixed z-50 w-80 rounded-lg border border-border bg-popover shadow-xl animate-in fade-in zoom-in-95"
      style={{ left, top }}
    >
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-border p-3">
        <TaskTypeIcon type={task.task_type} className="mt-0.5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3
            className={cn(
              'text-sm font-semibold leading-tight',
              isCompleted && 'text-muted-foreground line-through',
            )}
          >
            {task.title}
          </h3>
          <span className="text-[11px] text-muted-foreground">
            <TaskTypeLabel type={task.task_type} /> · {timeLabel(task.due_date) || t('popover.wholeDay')}
          </span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('popover.close')}
          className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex flex-col gap-2 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <PriorityBadge priority={task.priority} />
          <StatusBadge status={task.status} />
        </div>

        {(task.contact_name || task.deal_title || task.assigned_to_name) && (
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2 text-[11px]">
            {task.contact_name && task.contact_id && (
              <Link
                href={`/contatos/${task.contact_id}`}
                className="truncate text-muted-foreground hover:text-foreground"
              >
                <span className="font-medium text-foreground">{t('popover.contact')}</span>{' '}
                {task.contact_name}
              </Link>
            )}
            {task.deal_title && task.deal_id && (
              <Link
                href={`/funis?deal=${task.deal_id}`}
                className="truncate text-muted-foreground hover:text-foreground"
              >
                <span className="font-medium text-foreground">{t('popover.deal')}</span>{' '}
                {task.deal_title}
              </Link>
            )}
            {task.assigned_to_name && (
              <span className="truncate text-muted-foreground">
                <span className="font-medium text-foreground">{t('popover.responsible')}</span>{' '}
                {task.assigned_to_name}
              </span>
            )}
          </div>
        )}

        {error && (
          <p className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 text-[11px] text-destructive">
            {error}
          </p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          <Button
            size="sm"
            onClick={handleComplete}
            disabled={isCompleted || busy !== null}
            className="flex-1"
          >
            {busy === 'complete' ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isCompleted ? t('popover.completed') : t('popover.complete')}
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href={`/tarefas?focus=${task.id}`}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              {t('popover.edit')}
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
