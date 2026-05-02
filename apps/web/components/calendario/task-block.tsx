'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { User } from 'lucide-react';
import type { CalendarTask } from '@/lib/api/tasks';
import { cn } from '@/lib/utils';
import { TASK_TYPE_STYLES, timeLabel } from './calendar-utils';

interface TaskBlockProps {
  task: CalendarTask;
  draggableId: string;
  onClick: (e: React.MouseEvent) => void;
  /** Variante 'week' é mais compacta; 'day' mostra mais informação */
  variant: 'week' | 'day';
  /** Em pixels — altura do bloco. Mínimo 32 */
  height?: number;
  /** Top em px (week/day usam absolute positioning) */
  top?: number;
}

export function TaskBlock({
  task,
  draggableId,
  onClick,
  variant,
  height,
  top,
}: TaskBlockProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, dueDate: task.due_date },
  });

  const style = TASK_TYPE_STYLES[task.task_type];
  const isCompleted = task.status === 'completed';
  const time = timeLabel(task.due_date);
  const minHeight = variant === 'day' ? 64 : 40;

  const transformStyle: React.CSSProperties = {
    ...(transform
      ? { transform: CSS.Translate.toString(transform), zIndex: 50 }
      : {}),
    ...(top !== undefined ? { top: `${top}px` } : {}),
    minHeight: `${Math.max(height ?? minHeight, minHeight)}px`,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={(e) => {
        if (isDragging) return;
        e.stopPropagation();
        onClick(e);
      }}
      style={transformStyle}
      className={cn(
        'absolute left-1 right-1 flex items-stretch gap-1.5 overflow-hidden rounded-md border text-left text-[11px] transition-shadow',
        style.bg,
        style.border,
        style.text,
        isCompleted && 'opacity-50',
        isDragging && 'cursor-grabbing opacity-70 shadow-lg',
        !isDragging && 'cursor-grab hover:shadow-md',
      )}
      aria-label={`${task.title} ${time}`}
    >
      {/* Barra colorida lateral */}
      <span className={cn('w-1 shrink-0', style.side)} aria-hidden />

      <span className="flex min-w-0 flex-1 flex-col gap-0.5 px-1 py-1">
        <span
          className={cn(
            'truncate font-semibold leading-tight',
            isCompleted && 'line-through',
          )}
        >
          {task.title}
        </span>
        {time && (
          <span className="text-[10px] tabular-nums opacity-80">{time}</span>
        )}
        {variant === 'day' && task.contact_name && (
          <span className="flex items-center gap-1 truncate text-[10px] opacity-90">
            <User className="h-2.5 w-2.5 shrink-0" />
            {task.contact_name}
          </span>
        )}
      </span>
    </button>
  );
}
