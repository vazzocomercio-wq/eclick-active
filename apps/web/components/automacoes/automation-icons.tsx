import {
  Bell,
  Briefcase,
  CalendarClock,
  Clock,
  type LucideIcon,
  MessageCircle,
  MessageSquare,
  RefreshCw,
  Tag,
  UserPlus,
  Workflow,
} from 'lucide-react';
import type { AutomationTriggerType } from '@eclick-active/shared';
import type { AutomationActionType } from '@/lib/api/automations';
import { cn } from '@/lib/utils';

// ──────────────────────────────────────────────────────────
// Triggers
// ──────────────────────────────────────────────────────────

interface TriggerVisual {
  icon: LucideIcon;
  color: string;
  bg: string;
  label: string;
}

export const TRIGGER_VISUALS: Record<AutomationTriggerType, TriggerVisual> = {
  message_received: {
    icon: MessageCircle,
    color: 'text-blue-400',
    bg: 'bg-blue-500/15',
    label: 'Mensagem recebida',
  },
  deal_created: {
    icon: Briefcase,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/15',
    label: 'Deal criado',
  },
  deal_stage_changed: {
    icon: Workflow,
    color: 'text-purple-400',
    bg: 'bg-purple-500/15',
    label: 'Mudança de etapa',
  },
  contact_created: {
    icon: UserPlus,
    color: 'text-cyan-400',
    bg: 'bg-cyan-500/15',
    label: 'Contato criado',
  },
  task_overdue: {
    icon: CalendarClock,
    color: 'text-orange-400',
    bg: 'bg-orange-500/15',
    label: 'Tarefa atrasada',
  },
  time_based: {
    icon: Clock,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/15',
    label: 'Programado',
  },
  manual: {
    icon: RefreshCw,
    color: 'text-slate-400',
    bg: 'bg-slate-500/15',
    label: 'Manual',
  },
  webhook: {
    icon: RefreshCw,
    color: 'text-slate-400',
    bg: 'bg-slate-500/15',
    label: 'Webhook',
  },
};

export const TRIGGER_OPTIONS: AutomationTriggerType[] = [
  'message_received',
  'deal_created',
  'deal_stage_changed',
  'contact_created',
  'task_overdue',
  'manual',
];

export function TriggerBadge({
  type,
  className,
}: {
  type: AutomationTriggerType;
  className?: string;
}) {
  const v = TRIGGER_VISUALS[type];
  const Icon = v.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-medium',
        v.bg,
        v.color,
        className,
      )}
    >
      <Icon className="h-3 w-3" />
      {v.label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────
// Actions
// ──────────────────────────────────────────────────────────

interface ActionVisual {
  icon: LucideIcon;
  color: string;
  label: string;
}

export const ACTION_VISUALS: Record<AutomationActionType, ActionVisual> = {
  send_message: {
    icon: MessageSquare,
    color: 'text-blue-400',
    label: 'Enviar mensagem',
  },
  create_task: {
    icon: CalendarClock,
    color: 'text-yellow-400',
    label: 'Criar tarefa',
  },
  move_deal: {
    icon: Workflow,
    color: 'text-purple-400',
    label: 'Mover deal',
  },
  update_contact: {
    icon: Tag,
    color: 'text-emerald-400',
    label: 'Atualizar contato',
  },
  assign_conversation: {
    icon: UserPlus,
    color: 'text-cyan-400',
    label: 'Atribuir conversa',
  },
  notify_agent: {
    icon: Bell,
    color: 'text-orange-400',
    label: 'Notificar agente',
  },
  wait: {
    icon: Clock,
    color: 'text-slate-400',
    label: 'Aguardar',
  },
};

export const ACTION_OPTIONS: AutomationActionType[] = [
  'send_message',
  'create_task',
  'move_deal',
  'update_contact',
  'assign_conversation',
  'notify_agent',
  'wait',
];

export function ActionIcon({
  type,
  className,
}: {
  type: AutomationActionType;
  className?: string;
}) {
  const v = ACTION_VISUALS[type];
  const Icon = v.icon;
  return <Icon className={cn('h-4 w-4', v.color, className)} />;
}

export function actionLabel(t: AutomationActionType): string {
  return ACTION_VISUALS[t].label;
}

export function triggerLabel(t: AutomationTriggerType): string {
  return TRIGGER_VISUALS[t].label;
}
