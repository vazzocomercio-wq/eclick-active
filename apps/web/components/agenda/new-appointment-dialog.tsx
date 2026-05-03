'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, MapPin, Phone, Users, Video } from 'lucide-react';
import { toast } from 'sonner';
import type {
  AppointmentLocationType,
  AppointmentType,
  AvailabilitySlot,
} from '@eclick-active/shared';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { appointmentsApi } from '@/lib/api/appointments';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface NewAppointmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pré-preenche data (YYYY-MM-DD) — usado quando vem de "click no slot vazio". */
  defaultDate?: string;
  /** Pré-preenche horário (HH:mm). */
  defaultTime?: string;
  defaultContactId?: string;
  defaultDealId?: string;
  defaultConversationId?: string;
  onCreated: () => void;
}

const LOCATION_ICON: Record<AppointmentLocationType, typeof CalendarClock> = {
  online: Video,
  presencial: MapPin,
  telefone: Phone,
  flexivel: Users,
};

export function NewAppointmentDialog({
  open,
  onOpenChange,
  defaultDate,
  defaultTime,
  defaultContactId,
  defaultDealId,
  defaultConversationId,
  onCreated,
}: NewAppointmentDialogProps) {
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [typeId, setTypeId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(defaultDate ?? new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<AvailabilitySlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<AvailabilitySlot | null>(null);
  const [notes, setNotes] = useState('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);

  // Carrega tipos disponíveis
  useEffect(() => {
    if (!open) return;
    void appointmentsApi.listTypes().then((all) => {
      const active = all.filter((t) => t.is_active);
      setTypes(active);
      if (active.length > 0 && !typeId) {
        setTypeId(active[0]!.id);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Reset on open
  useEffect(() => {
    if (!open) return;
    setTitle('');
    setNotes('');
    setSelectedSlot(null);
    setDate(defaultDate ?? new Date().toISOString().slice(0, 10));
  }, [open, defaultDate]);

  // Busca slots quando data ou tipo mudam
  useEffect(() => {
    if (!open || !date) return;
    const ctrl = new AbortController();
    setLoadingSlots(true);
    setSelectedSlot(null);
    appointmentsApi
      .getSlots(date, typeId ? { type_id: typeId } : {}, ctrl.signal)
      .then((s) => {
        setSlots(s);
        // Pré-seleciona slot que bate com defaultTime
        if (defaultTime) {
          const target = s.find((slot) =>
            new Date(slot.start_time).toTimeString().slice(0, 5) === defaultTime,
          );
          if (target) setSelectedSlot(target);
        }
      })
      .catch((err) => {
        if ((err as { name?: string })?.name === 'AbortError') return;
      })
      .finally(() => setLoadingSlots(false));
    return () => ctrl.abort();
  }, [open, date, typeId, defaultTime]);

  async function handleSave() {
    if (!title.trim()) {
      toast.error('Título é obrigatório');
      return;
    }
    if (!selectedSlot) {
      toast.error('Selecione um horário disponível');
      return;
    }
    setSaving(true);
    try {
      await appointmentsApi.create({
        title: title.trim(),
        start_time: selectedSlot.start_time,
        end_time: selectedSlot.end_time,
        ...(typeId ? { appointment_type_id: typeId } : {}),
        ...(defaultContactId ? { contact_id: defaultContactId } : {}),
        ...(defaultDealId ? { deal_id: defaultDealId } : {}),
        ...(defaultConversationId ? { conversation_id: defaultConversationId } : {}),
        assigned_to: selectedSlot.agent_id,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      toast.success('Agendamento criado', {
        description: new Date(selectedSlot.start_time).toLocaleString('pt-BR', {
          dateStyle: 'short',
          timeStyle: 'short',
        }),
      });
      onCreated();
      onOpenChange(false);
    } catch (err) {
      toast.error('Falha ao agendar', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedType = types.find((t) => t.id === typeId);
  const LocationIcon = selectedType ? LOCATION_ICON[selectedType.location_type] : CalendarClock;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-cyan-500" />
            Novo agendamento
          </DialogTitle>
          <DialogDescription>
            A IA mostra apenas horários disponíveis considerando agenda dos agentes e
            tarefas conflitantes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <select
                value={typeId}
                onChange={(e) => setTypeId(e.target.value)}
                className={cn(
                  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                  'focus:outline-none focus:ring-2 focus:ring-ring',
                )}
              >
                {types.length === 0 && <option value="">— sem tipos cadastrados —</option>}
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.duration_minutes}min)
                  </option>
                ))}
              </select>
              {selectedType && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <LocationIcon className="h-3 w-3" />
                  {selectedType.location_type}
                  {selectedType.location_details && ` · ${selectedType.location_details}`}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Data</Label>
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min={new Date().toISOString().slice(0, 10)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Título *</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Reunião — apresentação Vazzo"
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Horário disponível *</Label>
            {loadingSlots ? (
              <div className="flex items-center justify-center py-4 text-xs text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando slots…
              </div>
            ) : slots.length === 0 ? (
              <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
                Nenhum slot disponível nessa data. Tente outra data ou ajuste o horário comercial.
              </div>
            ) : (
              <div className="grid max-h-48 grid-cols-3 gap-1.5 overflow-y-auto rounded-md border border-border bg-card p-2 sm:grid-cols-4">
                {slots.map((s) => {
                  const time = new Date(s.start_time).toLocaleTimeString('pt-BR', {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const isSelected = selectedSlot?.start_time === s.start_time && selectedSlot?.agent_id === s.agent_id;
                  return (
                    <button
                      key={`${s.start_time}-${s.agent_id}`}
                      type="button"
                      onClick={() => setSelectedSlot(s)}
                      className={cn(
                        'flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors',
                        isSelected
                          ? 'border-cyan-500 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300'
                          : 'border-border bg-background hover:border-cyan-500/40 hover:bg-cyan-500/5',
                      )}
                    >
                      <span className="text-sm font-semibold tabular-nums">{time}</span>
                      <span className="truncate text-[10px] text-muted-foreground">
                        {s.agent_name ?? 'Agente'}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Notas</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Observações sobre o agendamento (opcional)"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving || !selectedSlot || !title.trim()}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Agendar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
