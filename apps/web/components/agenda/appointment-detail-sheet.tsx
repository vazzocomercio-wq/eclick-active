'use client';

import { useState } from 'react';
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MapPin,
  MessageSquare,
  Phone,
  RotateCcw,
  Trash2,
  Users,
  Video,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AppointmentDetail,
  AppointmentLocationType,
  AppointmentStatus,
} from '@eclick-active/shared';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { InitialsAvatar } from '@/components/contacts/initials-avatar';
import { appointmentsApi } from '@/lib/api/appointments';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface AppointmentDetailSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appointment: AppointmentDetail | null;
  onChanged: () => void;
}

const LOCATION_ICON: Record<AppointmentLocationType, typeof CalendarClock> = {
  online: Video,
  presencial: MapPin,
  telefone: Phone,
  flexivel: Users,
};

const STATUS_COLOR: Record<AppointmentStatus, string> = {
  scheduled: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  confirmed: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  cancelled: 'bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30',
  completed: 'bg-muted text-muted-foreground border-border',
  no_show: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  rescheduled: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
};

const STATUS_LABEL: Record<AppointmentStatus, string> = {
  scheduled: 'Agendado',
  confirmed: 'Confirmado',
  cancelled: 'Cancelado',
  completed: 'Concluído',
  no_show: 'No-show',
  rescheduled: 'Reagendado',
};

export function AppointmentDetailSheet({
  open,
  onOpenChange,
  appointment,
  onChanged,
}: AppointmentDetailSheetProps) {
  const [busy, setBusy] = useState<string | null>(null);

  if (!appointment) return null;

  async function action(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
      toast.success('OK');
      onChanged();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha', {
        description: err instanceof ApiError ? err.message : 'Erro',
      });
    } finally {
      setBusy(null);
    }
  }

  const start = new Date(appointment.start_time);
  const end = new Date(appointment.end_time);
  const durationMin = Math.round((end.getTime() - start.getTime()) / 60_000);

  const LocationIcon = appointment.location_type
    ? LOCATION_ICON[appointment.location_type]
    : CalendarClock;

  const isActive = appointment.status === 'scheduled' || appointment.status === 'confirmed';

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-cyan-500" />
            {appointment.title}
          </SheetTitle>
          <SheetDescription>
            {start.toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-3 py-4">
          {/* Status + Type badges */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-medium',
                STATUS_COLOR[appointment.status],
              )}
            >
              {STATUS_LABEL[appointment.status]}
            </span>
            {appointment.type && (
              <span
                className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px]"
                style={{
                  borderColor: `${appointment.type.color}40`,
                  backgroundColor: `${appointment.type.color}15`,
                  color: appointment.type.color,
                }}
              >
                {appointment.type.name}
              </span>
            )}
            {appointment.created_by_ai && (
              <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                <Bot className="h-3 w-3" />
                IA
              </span>
            )}
          </div>

          {/* Horário + duração */}
          <div className="rounded-md border border-border bg-card p-3 text-xs">
            <div className="font-medium text-foreground">
              {start.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} —{' '}
              {end.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </div>
            <span className="text-muted-foreground">{durationMin} minutos</span>
          </div>

          {/* Localização */}
          {(appointment.location_type || appointment.location_details) && (
            <div className="flex items-start gap-2 rounded-md border border-border bg-card p-3 text-xs">
              <LocationIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <div className="flex flex-col">
                <span className="font-medium capitalize">{appointment.location_type ?? 'flexível'}</span>
                {appointment.location_details && (
                  <span className="text-muted-foreground">{appointment.location_details}</span>
                )}
              </div>
            </div>
          )}

          {/* Contato */}
          {appointment.contact && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
              <InitialsAvatar
                name={appointment.contact.name}
                src={appointment.contact.avatar_url}
                className="h-8 w-8 text-[11px]"
              />
              <div className="flex flex-1 flex-col min-w-0">
                <span className="truncate text-sm font-medium">
                  {appointment.contact.name ?? 'Contato sem nome'}
                </span>
                {appointment.contact.phone && (
                  <span className="truncate text-[11px] text-muted-foreground">
                    {appointment.contact.phone}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Agente */}
          {appointment.agent && (
            <div className="flex items-center gap-2 rounded-md border border-border bg-card p-3">
              <InitialsAvatar
                name={appointment.agent.display_name}
                src={appointment.agent.avatar_url}
                className="h-8 w-8 text-[11px]"
              />
              <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Responsável
                </span>
                <span className="text-sm font-medium">
                  {appointment.agent.display_name ?? 'Sem nome'}
                </span>
              </div>
            </div>
          )}

          {/* Deal */}
          {appointment.deal && (
            <div className="rounded-md border border-border bg-card p-3 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Deal vinculado
              </span>
              <p className="mt-0.5 font-medium">{appointment.deal.title}</p>
              {appointment.deal.value !== null && (
                <span className="text-muted-foreground">
                  {appointment.deal.value.toLocaleString('pt-BR', {
                    style: 'currency',
                    currency: appointment.deal.currency || 'BRL',
                  })}
                </span>
              )}
            </div>
          )}

          {/* Notas */}
          {appointment.notes && (
            <div className="rounded-md border border-border bg-card p-3 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Notas</span>
              <p className="mt-0.5 whitespace-pre-wrap leading-snug">{appointment.notes}</p>
            </div>
          )}

          {/* Conversa link */}
          {appointment.conversation_id && (
            <a
              href={`/conversas?id=${appointment.conversation_id}`}
              className="inline-flex items-center gap-1.5 self-start rounded-md border border-border bg-card px-3 py-1.5 text-xs hover:bg-muted"
            >
              <MessageSquare className="h-3 w-3" />
              Abrir conversa
              <ExternalLink className="h-3 w-3 opacity-60" />
            </a>
          )}

          {/* Ações */}
          {isActive && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3">
              <Button
                size="sm"
                onClick={() => action('complete', () => appointmentsApi.complete(appointment.id))}
                disabled={busy !== null}
                className="bg-emerald-600 hover:bg-emerald-700"
              >
                {busy === 'complete' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <CheckCircle2 className="mr-1 h-3 w-3" />
                )}
                Completar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const reason = window.prompt('Motivo do cancelamento (opcional):') ?? undefined;
                  void action('cancel', () => appointmentsApi.cancel(appointment.id, reason));
                }}
                disabled={busy !== null}
              >
                {busy === 'cancel' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <XCircle className="mr-1 h-3 w-3" />
                )}
                Cancelar
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const ans = window.prompt(
                    'Reagendar para (ISO 8601, ex: 2026-05-12T15:00:00-03:00):',
                  );
                  if (!ans) return;
                  void action('reschedule', () => appointmentsApi.reschedule(appointment.id, ans));
                }}
                disabled={busy !== null}
              >
                {busy === 'reschedule' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <RotateCcw className="mr-1 h-3 w-3" />
                )}
                Reagendar
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => action('no-show', () => appointmentsApi.markNoShow(appointment.id))}
                disabled={busy !== null}
                className="text-amber-600 hover:text-amber-700"
              >
                {busy === 'no-show' ? (
                  <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="mr-1 h-3 w-3" />
                )}
                No-show
              </Button>
            </div>
          )}

          {appointment.cancelled_reason && (
            <div className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs">
              <span className="text-[10px] uppercase tracking-wider text-red-600">Motivo</span>
              <p className="mt-0.5">{appointment.cancelled_reason}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
