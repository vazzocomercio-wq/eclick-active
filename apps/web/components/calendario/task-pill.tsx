'use client';

import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import type { CalendarTask } from '@/lib/api/tasks';
import { cn } from '@/lib/utils';
import { TASK_TYPE_STYLES, timeLabel } from './calendar-utils';

interface TaskPillProps {
  task: CalendarTask;
  onClick: (e: React.MouseEvent) => void;
  /** ID que identifica esta pill no DnD (suffix com source date pra evitar colisão com blocos) */
  draggableId: string;
}

/**
 * Pill compacta usada na visão Mês.
 * Mostra hora (se tiver) + título com truncate.
 */
export function TaskPill({ task, onClick, draggableId }: TaskPillProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: draggableId,
    data: { taskId: task.id, dueDate: task.due_date },
  });

  const style = TASK_TYPE_STYLES[task.task_type];
  const isCompleted = task.status === 'completed';
  const time = timeLabel(task.due_date);

  const transformStyle = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: 50 }
    : undefined;

  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      onClick={(e) => {
        // Evita click após drag (dnd-kit já lida, mas garantimos)
        if (isDragging) return;
        e.stopPropagation();
        onClick(e);
      }}
      style={transformStyle}
      className={cn(
        'group flex w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[11px] font-medium transition-all',
        'border',
        style.bg,
        style.border,
        style.text,
        isCompleted && 'opacity-50 line-through',
        isDragging && 'cursor-grabbing opacity-60 shadow-lg',
        !isDragging && 'cursor-grab hover:brightness-110',
      )}
      aria-label={`${task.title} ${time}`}
    >
      {time && (
        <span className="shrink-0 tabular-nums opacity-80">{time}</span>
      )}
      <span className="truncate">{task.title}</span>
    </button>
  );
}
