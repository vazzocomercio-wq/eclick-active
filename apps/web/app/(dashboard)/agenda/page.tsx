'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Users,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AppointmentDetail,
  AppointmentLocationType,
} from '@eclick-active/shared';
import { Button } from '@/components/ui/button';
import { appointmentsApi } from '@/lib/api/appointments';
import { ApiError } from '@/lib/api/client';
import { NewAppointmentDialog } from '@/components/agenda/new-appointment-dialog';
import { AppointmentDetailSheet } from '@/components/agenda/appointment-detail-sheet';
import { cn } from '@/lib/utils';

const LOCATION_ICON: Record<AppointmentLocationType, typeof CalendarClock> = {
  online: Video,
  presencial: MapPin,
  telefone: Phone,
  flexivel: Users,
};

const HOURS = Array.from({ length: 14 }, (_, i) => i + 7); // 7h–20h
const DAYS_PT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export default function AgendaPage() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [appointments, setAppointments] = useState<AppointmentDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<AppointmentDetail | null>(null);
  const [creating, setCreating] = useState<{
    date?: string;
    time?: string;
  } | null>(null);

  const weekEnd = useMemo(() => {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 7);
    return e;
  }, [weekStart]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await appointmentsApi.getCalendar(
        weekStart.toISOString(),
        weekEnd.toISOString(),
      );
      setAppointments(data);
    } catch (err) {
      toast.error('Falha ao carregar agenda', {
        description: err instanceof ApiError ? err.message : 'Erro',
      });
    } finally {
      setLoading(false);
    }
  }, [weekStart, weekEnd]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentTimeY = (() => {
    const now = new Date();
    if (now.getHours() < HOURS[0]! || now.getHours() > HOURS[HOURS.length - 1]!) return null;
    return ((now.getHours() - HOURS[0]!) * 60 + now.getMinutes()) / (HOURS.length * 60);
  })();

  function navigateWeek(direction: -1 | 1) {
    const next = new Date(weekStart);
    next.setDate(next.getDate() + direction * 7);
    setWeekStart(next);
  }

  function goToToday() {
    setWeekStart(startOfWeek(new Date()));
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="h-4 w-4 text-cyan-500" />
          <h1 className="text-lg font-semibold">Agenda</h1>
        </div>

        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => navigateWeek(-1)} aria-label="Semana anterior">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            Hoje
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigateWeek(1)} aria-label="Próxima semana">
            <ChevronRight className="h-4 w-4" />
          </Button>
          <span className="ml-2 text-sm font-medium">
            {weekStart.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} —{' '}
            {new Date(weekEnd.getTime() - 86_400_000).toLocaleDateString('pt-BR', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
            <RefreshCw className={cn('mr-1 h-3 w-3', loading && 'animate-spin')} />
            Atualizar
          </Button>
          <Button size="sm" onClick={() => setCreating({})}>
            <Plus className="mr-1 h-3 w-3" /> Novo agendamento
          </Button>
        </div>
      </header>

      {/* Week grid */}
      <div className="flex-1 overflow-auto">
        <div className="min-w-[900px] p-3">
          {/* Header row — dias */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] gap-px border-b border-border bg-card">
            <div /> {/* canto vazio */}
            {days.map((d) => {
              const isToday = d.toDateString() === today.toDateString();
              return (
                <div
                  key={d.toISOString()}
                  className={cn(
                    'flex flex-col items-center justify-center border-l border-border py-2',
                    isToday && 'bg-cyan-500/5',
                  )}
                >
                  <span className="text-[10px] uppercase text-muted-foreground">
                    {DAYS_PT[d.getDay()]}
                  </span>
                  <span
                    className={cn(
                      'text-lg font-semibold tabular-nums',
                      isToday && 'text-cyan-600 dark:text-cyan-400',
                    )}
                  >
                    {d.getDate().toString().padStart(2, '0')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Time grid */}
          <div className="relative grid grid-cols-[60px_repeat(7,1fr)] gap-px bg-border">
            {HOURS.flatMap((hour) => [
              <div
                key={`label-${hour}`}
                className="bg-background px-1 py-2 text-right text-[10px] tabular-nums text-muted-foreground"
              >
                {hour.toString().padStart(2, '0')}:00
              </div>,
              ...days.map((d) => (
                <div
                  key={`${d.toISOString()}-${hour}`}
                  onClick={() =>
                    setCreating({
                      date: toLocalDate(d),
                      time: `${hour.toString().padStart(2, '0')}:00`,
                    })
                  }
                  className="relative h-12 cursor-pointer bg-background transition-colors hover:bg-muted/40"
                />
              )),
            ])}

            {/* Current time indicator */}
            {currentTimeY !== null && (() => {
              const todayIdx = days.findIndex((d) => d.toDateString() === today.toDateString());
              if (todayIdx === -1) return null;
              const top = currentTimeY * (HOURS.length * 48); // 48px row
              return (
                <div
                  className="pointer-events-none absolute left-[60px] right-0 z-10"
                  style={{ top: `${top}px` }}
                >
                  <div className="absolute h-px w-full bg-red-500/60" />
                </div>
              );
            })()}

            {/* Appointment blocks */}
            {appointments.map((appt) => {
              const block = computeBlockPosition(appt, days, HOURS);
              if (!block) return null;
              const Icon = appt.location_type ? LOCATION_ICON[appt.location_type] : CalendarClock;
              const color = appt.type?.color ?? '#00E5FF';
              return (
                <button
                  key={appt.id}
                  type="button"
                  onClick={() => setSelected(appt)}
                  className={cn(
                    'absolute z-20 overflow-hidden rounded-md border-l-2 px-1.5 py-1 text-left text-[10px] shadow-sm transition-all hover:z-30 hover:shadow-md',
                    appt.status === 'cancelled' && 'opacity-50 line-through',
                    appt.status === 'completed' && 'opacity-60',
                  )}
                  style={{
                    top: `${block.top}px`,
                    left: `calc(60px + ((100% - 60px) / 7) * ${block.col})`,
                    width: `calc((100% - 60px) / 7 - 4px)`,
                    height: `${block.height}px`,
                    backgroundColor: `${color}20`,
                    borderLeftColor: color,
                  }}
                >
                  <div className="flex items-center gap-1 font-semibold leading-tight">
                    <Icon className="h-2.5 w-2.5 shrink-0" style={{ color }} />
                    <span className="truncate">{appt.title}</span>
                  </div>
                  {appt.contact?.name && (
                    <div className="truncate text-muted-foreground">{appt.contact.name}</div>
                  )}
                  <div className="truncate text-muted-foreground">
                    {new Date(appt.start_time).toLocaleTimeString('pt-BR', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <NewAppointmentDialog
        open={creating !== null}
        onOpenChange={(o) => !o && setCreating(null)}
        defaultDate={creating?.date}
        defaultTime={creating?.time}
        onCreated={() => void reload()}
      />

      <AppointmentDetailSheet
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
        appointment={selected}
        onChanged={() => void reload()}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay()); // domingo = 0
  return out;
}

function toLocalDate(d: Date): string {
  const yr = d.getFullYear();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const dy = d.getDate().toString().padStart(2, '0');
  return `${yr}-${mo}-${dy}`;
}

function computeBlockPosition(
  appt: AppointmentDetail,
  days: Date[],
  hours: number[],
): { top: number; height: number; col: number } | null {
  const start = new Date(appt.start_time);
  const end = new Date(appt.end_time);

  const dayIdx = days.findIndex((d) => d.toDateString() === start.toDateString());
  if (dayIdx === -1) return null;

  const startHour = start.getHours() + start.getMinutes() / 60;
  const endHour = end.getHours() + end.getMinutes() / 60;

  const minHour = hours[0]!;
  const maxHour = hours[hours.length - 1]! + 1;
  if (endHour <= minHour || startHour >= maxHour) return null;

  const rowHeight = 48; // px (h-12)
  const top = (Math.max(startHour, minHour) - minHour) * rowHeight + 1; // +1 pra header
  const height = Math.max(20, (Math.min(endHour, maxHour) - Math.max(startHour, minHour)) * rowHeight - 2);

  return { top: top + 1, height, col: dayIdx };
}
