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
import type { TaskPriority, TaskStatus, TaskType } from '@eclick-active/shared';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// Priority
// ──────────────────────────────────────────────────────────

const PRIORITY_STYLES: Record<TaskPriority, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Baixa' },
  normal: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Normal' },
  high: { bg: 'bg-orange-500/15', text: 'text-orange-400', label: 'Alta' },
  urgent: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Urgente' },
};

export function PriorityBadge({
  priority,
  className,
}: {
  priority: TaskPriority;
  className?: string;
}) {
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
      {s.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// Status
// ──────────────────────────────────────────────────────────

const STATUS_STYLES: Record<TaskStatus, { bg: string; text: string; label: string }> = {
  pending: { bg: 'bg-yellow-500/15', text: 'text-yellow-400', label: 'Pendente' },
  in_progress: { bg: 'bg-blue-500/15', text: 'text-blue-400', label: 'Em andamento' },
  completed: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', label: 'Concluída' },
  cancelled: { bg: 'bg-slate-500/15', text: 'text-slate-400', label: 'Cancelada' },
  overdue: { bg: 'bg-red-500/15', text: 'text-red-400', label: 'Atrasada' },
};

export function StatusBadge({
  status,
  className,
}: {
  status: TaskStatus;
  className?: string;
}) {
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
      {s.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// Task type icon
// ──────────────────────────────────────────────────────────

const TYPE_ICONS: Record<TaskType, { icon: LucideIcon; color: string; label: string }> = {
  call: { icon: Phone, color: 'text-blue-400', label: 'Ligação' },
  email: { icon: Mail, color: 'text-cyan-400', label: 'Email' },
  meeting: { icon: Video, color: 'text-purple-400', label: 'Reunião' },
  follow_up: { icon: Users, color: 'text-emerald-400', label: 'Follow-up' },
  whatsapp: { icon: MessageCircle, color: 'text-green-400', label: 'WhatsApp' },
  proposal: { icon: CheckCircle2, color: 'text-orange-400', label: 'Proposta' },
  custom: { icon: Calendar, color: 'text-muted-foreground', label: 'Personalizado' },
};

export function TaskTypeIcon({
  type,
  className,
}: {
  type: TaskType;
  className?: string;
}) {
  const v = TYPE_ICONS[type];
  const Icon = v.icon;
  return <Icon className={cn('h-4 w-4', v.color, className)} aria-label={v.label} />;
}

export function TaskTypeLabel({ type }: { type: TaskType }) {
  return <>{TYPE_ICONS[type].label}</>;
}

// ──────────────────────────────────────────────────────────
// AI badge
// ──────────────────────────────────────────────────────────

export function AICreatedBadge({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary',
        className,
      )}
    >
      <Sparkles className="h-3 w-3" />
      Criada por IA
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

export function priorityLabel(p: TaskPriority): string {
  return PRIORITY_STYLES[p].label;
}

export function taskTypeLabel(t: TaskType): string {
  return TYPE_ICONS[t].label;
}
