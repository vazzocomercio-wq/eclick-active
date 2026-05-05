'use client';

import {
  Sparkles,
  AlertCircle,
  CheckCircle2,
  RotateCw,
  UserPlus,
  ArrowUp,
  StickyNote,
  Tag as TagIcon,
  Package,
} from 'lucide-react';
import type { SacTicketAction } from '@/lib/api/sac';
import { cn } from '@/lib/utils';

const ACTION_ICONS: Record<string, typeof Sparkles> = {
  created: Sparkles,
  status_changed: RotateCw,
  priority_changed: ArrowUp,
  category_changed: TagIcon,
  assigned: UserPlus,
  escalated: ArrowUp,
  note_added: StickyNote,
  response_sent: CheckCircle2,
  order_linked: Package,
  sla_breached: AlertCircle,
  resolved: CheckCircle2,
  reopened: RotateCw,
  ai_classified: Sparkles,
  preventive_created: Sparkles,
  customer_rated: CheckCircle2,
};

const ACTION_LABELS: Record<string, string> = {
  created: 'Ticket criado',
  status_changed: 'Status alterado',
  priority_changed: 'Prioridade alterada',
  category_changed: 'Categoria alterada',
  assigned: 'Atribuído',
  escalated: 'Escalado',
  note_added: 'Nota interna',
  response_sent: 'Resposta enviada',
  order_linked: 'Pedido vinculado',
  order_checked: 'Pedido verificado',
  logistics_contacted: 'Logística contatada',
  refund_initiated: 'Reembolso iniciado',
  exchange_initiated: 'Troca iniciada',
  sla_breached: 'SLA violado',
  resolved: 'Resolvido',
  reopened: 'Reaberto',
  ai_classified: 'Classificado pela IA',
  ai_suggested: 'IA sugeriu resposta',
  preventive_created: 'Ticket preventivo criado',
  customer_rated: 'Cliente avaliou atendimento',
};

interface TicketTimelineProps {
  actions: SacTicketAction[];
}

export function TicketTimeline({ actions }: TicketTimelineProps) {
  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground">
        Sem ações registradas ainda
      </div>
    );
  }
  return (
    <ol className="flex flex-col">
      {actions.map((a, i) => {
        const Icon = ACTION_ICONS[a.action_type] ?? Sparkles;
        const label = ACTION_LABELS[a.action_type] ?? a.action_type;
        const time = formatTime(a.created_at);
        return (
          <li key={a.id} className="relative flex gap-3 pb-3">
            {i < actions.length - 1 && (
              <div className="absolute left-[15px] top-7 bottom-0 w-px bg-border" />
            )}
            <div
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border',
                a.action_type === 'sla_breached'
                  ? 'border-red-500/40 bg-red-500/10 text-red-600'
                  : a.action_type === 'resolved'
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600'
                    : a.actor_type === 'ai'
                      ? 'border-cyan-500/40 bg-cyan-500/10 text-cyan-600'
                      : 'border-border bg-muted/40 text-muted-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </div>
            <div className="flex-1 pt-1">
              <div className="text-sm font-medium">{label}</div>
              {a.description && (
                <div className="mt-0.5 text-xs text-foreground/70">{a.description}</div>
              )}
              {(a.old_value || a.new_value) && (
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {a.old_value && <span className="font-mono">{a.old_value}</span>}
                  {a.old_value && a.new_value && <span> → </span>}
                  {a.new_value && <span className="font-mono">{a.new_value}</span>}
                </div>
              )}
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {time}
                {a.actor_type === 'ai' && ' • IA'}
                {a.actor_type === 'system' && ' • Sistema'}
                {a.actor_type === 'customer' && ' • Cliente'}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60_000);
    if (min < 1) return 'agora';
    if (min < 60) return `${min}m atrás`;
    if (min < 1440) return `${Math.floor(min / 60)}h atrás`;
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
