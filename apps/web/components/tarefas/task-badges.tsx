'use client';

import {
  Calendar,
  CheckCircle2,
  Mail,
  MessageCircle,
  Phone,
  type LucideIcon,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { TaskPriority, TaskStatus, TaskType } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// Priority
// ──────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; text: string }> = {
  low: { bg: 'bg-slate-500/15', text: 'text-slate-400' },
  normal: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400' },
  urgent: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
  const t = useTranslations('tarefas.badges.priority');
  const s = PRIORITY_STYLES[priority];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        s.bg,
        s.text,
        className,
      )}
    >
      {t(priority)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string }> = {
  pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400' },
  in_progress: { bg: 'bg-blue-500/15', text: 'text-blue-400' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  cancelled: { bg: 'bg-slate-500/15', text: 'text-slate-400' },
  overdue: { bg: 'bg-red-500/15', text: 'text-red-400' },
};

export function StatusBadge({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
  const t = useTranslations('tarefas.badges.status');
  const s = STATUS_STYLES[status];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium',
        s.bg,
        s.text,
        className,
      )}
    >
      {t(status)}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// Task type icon
// ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<TaskType, { icon: LucideIcon; color: string }> = {
  call: { icon: Phone, color: 'text-blue-400' },
  email: { icon: Mail, color: 'text-cyan-400' },
  meeting: { icon: Video, color: 'text-purple-400' },
  follow_up: { icon: Users, color: 'text-emerald-400' },
  whatsapp: { icon: MessageCircle, color: 'text-green-400' },
  proposal: { icon: CheckCircle2, color: 'text-orange-400' },
  custom: { icon: Calendar, color: 'text-muted-foreground' },
};

export function TaskTypeIcon({
  type,
  className,
}: {
  type: TaskType;
  className?: string;
}) {
  const t = useTranslations('tarefas.badges.type');
  const v = TYPE_ICONS[type];
  const Icon = v.icon;
  return <Icon className={cn('h-4 w-4', v.color, className)} aria-label={t(type)} />;
}

export function TaskTypeLabel({ type }: { type: TaskType }) {
  const t = useTranslations('tarefas.badges.type');
  return <>{t(type)}</>;
}

// ──────────────────────────────────────────────────────────
// AI badge
// ──────────────────────────────────────────────────────────

export function AICreatedBadge({ className }: { className?: string }) {
  const t = useTranslations('tarefas.badges');
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary',
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      {t('aiCreated')}
    </span>
  );
}

export const TASK_TYPE_VALUES: TaskType[] = [
  'call',
  'email',
  'meeting',
  'follow_up',
  'whatsapp',
  'proposal',
  'custom',
];

export const TASK_PRIORITY_VALUES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];
