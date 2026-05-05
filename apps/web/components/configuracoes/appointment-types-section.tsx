'use client';

import { useEffect, useState } from 'react';
import {
  Clock,
  Loader2,
  MapPin,
  Pencil,
  Phone,
  Plus,
  Sliders,
  Trash2,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import type {
  AppointmentCustomField,
  AppointmentLocationType,
  AppointmentType,
} from '@eclick-active/shared';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useConfirm } from '@/components/ui/confirm-provider';
import { appointmentsApi } from '@/lib/api/appointments';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { CustomFieldsSchemaEditor } from './custom-fields-schema-editor';

const LOC_ICON: Record<AppointmentLocationType, typeof Clock> = {
  online: Video,
  presencial: MapPin,
  telefone: Phone,
  flexivel: Clock,
};

const LOC_LABEL: Record<AppointmentLocationType, string> = {
  online: 'Online',
  presencial: 'Presencial',
  telefone: 'Telefone',
  flexivel: 'Flexível',
};

interface FormState {
  name: string;
  description: string;
  duration_minutes: number;
  buffer_minutes: number;
  min_advance_hours: number;
  max_per_day: number;
  location_type: AppointmentLocationType;
  location_details: string;
  color: string;
  is_active: boolean;
  custom_fields_schema: AppointmentCustomField[];
}

const DEFAULT_FORM: FormState = {
  name: '',
  description: '',
  duration_minutes: 30,
  buffer_minutes: 15,
  min_advance_hours: 2,
  max_per_day: 10,
  location_type: 'online',
  location_details: '',
  color: '#00E5FF',
  is_active: true,
  custom_fields_schema: [],
};

/**
 * Section de Configurações > Agenda > Tipos de agendamento.
 * Lista os AppointmentTypes da org + permite criar/editar/remover.
 *
 * Cada tipo carrega:
 *   - Basics: nome, descrição, duração, buffer, antecedência, max/dia
 *   - Localização: online/presencial/telefone/flexível + detalhes
 *   - Cor (hex)
 *   - Schema de custom fields (Fase 3.E) — coletados quando agendar
 */
export function AppointmentTypesSection() {
  const [types, setTypes] = useState<AppointmentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AppointmentType | null>(null);
  const [creating, setCreating] = useState(false);
  const confirm = useConfirm();

  async function reload() {
    setLoading(true);
    setError(null);
    try {
      const data = await appointmentsApi.listTypes();
      setTypes(data);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar tipos',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reload();
  }, []);

  async function handleDelete(t: AppointmentType) {
    const ok = await confirm({
      title: 'Remover tipo de agendamento?',
      description: `O tipo "${t.name}" será excluído. Agendamentos existentes que usam esse tipo permanecerão (sem referência).`,
      confirmLabel: 'Remover',
      variant: 'destructive',
    });
    if (!ok) return;
    try {
      await appointmentsApi.deleteType(t.id);
      toast.success('Tipo removido');
      void reload();
    } catch (err) {
      toast.error('Falha ao remover', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Tipos de agendamento</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Defina os tipos disponíveis (consulta, exame, corte, vistoria…) e os
            campos extras que cada um precisa coletar do cliente.
          </p>
        </div>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" />
          Novo tipo
        </Button>
      </CardHeader>

      <CardContent>
        {error && (
          <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : types.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
            Nenhum tipo cadastrado ainda. Crie o primeiro pra começar.
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {types.map((t) => (
              <TypeRow
                key={t.id}
                type={t}
                onEdit={() => setEditing(t)}
                onDelete={() => void handleDelete(t)}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AppointmentTypeDialog
        open={creating || !!editing}
        editing={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={() => {
          setCreating(false);
          setEditing(null);
          void reload();
        }}
      />
    </Card>
  );
}

function TypeRow({
  type,
  onEdit,
  onDelete,
}: {
  type: AppointmentType;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const LocIcon = LOC_ICON[type.location_type];
  const fieldCount = (type.custom_fields_schema ?? []).length;

  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-md border border-border bg-card p-3 transition-colors',
        !type.is_active && 'opacity-60',
      )}
    >
      <span
        className="h-8 w-1 shrink-0 rounded-full"
        style={{ backgroundColor: type.color }}
      />
      <div className="flex flex-1 flex-col gap-0.5 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{type.name}</span>
          {!type.is_active && (
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">
              Inativo
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {type.duration_minutes}min
          </span>
          <span className="inline-flex items-center gap-1">
            <LocIcon className="h-3 w-3" />
            {LOC_LABEL[type.location_type]}
          </span>
          {fieldCount > 0 && (
            <span className="inline-flex items-center gap-1 text-cyan-600 dark:text-cyan-400">
              <Sliders className="h-3 w-3" />
              {fieldCount} campo{fieldCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      </div>

      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function AppointmentTypeDialog({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: AppointmentType | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setForm({
        name: editing.name,
        description: editing.description ?? '',
        duration_minutes: editing.duration_minutes,
        buffer_minutes: editing.buffer_minutes,
        min_advance_hours: editing.min_advance_hours,
        max_per_day: editing.max_per_day,
        location_type: editing.location_type,
        location_details: editing.location_details ?? '',
        color: editing.color,
        is_active: editing.is_active,
        custom_fields_schema: editing.custom_fields_schema ?? [],
      });
    } else {
      setForm(DEFAULT_FORM);
    }
  }, [open, editing]);

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error('Nome é obrigatório');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        duration_minutes: form.duration_minutes,
        buffer_minutes: form.buffer_minutes,
        min_advance_hours: form.min_advance_hours,
        max_per_day: form.max_per_day,
        location_type: form.location_type,
        location_details: form.location_details.trim() || undefined,
        color: form.color,
        is_active: form.is_active,
        custom_fields_schema: form.custom_fields_schema,
      };
      if (editing) {
        await appointmentsApi.updateType(editing.id, payload);
        toast.success('Tipo atualizado');
      } else {
        await appointmentsApi.createType(payload);
        toast.success('Tipo criado');
      }
      onSaved();
    } catch (err) {
      toast.error('Falha ao salvar', {
        description: err instanceof ApiError ? err.message : 'Erro desconhecido',
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && !o && onClose()}>
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Editar "${editing.name}"` : 'Novo tipo de agendamento'}
          </DialogTitle>
          <DialogDescription>
            Configure duração, localização e os campos personalizados que serão
            coletados quando alguém agendar esse tipo.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1">
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Nome *</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Ex: Consulta nutricional"
                  maxLength={80}
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Cor</Label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
                  />
                  <Input
                    value={form.color}
                    onChange={(e) => setForm({ ...form, color: e.target.value })}
                    className="h-9 flex-1 font-mono text-xs"
                    maxLength={7}
                  />
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <Label className="text-[11px]">Descrição</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Como esse tipo de atendimento funciona (opcional)"
                maxLength={1000}
                rows={2}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Duração (min) *</Label>
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={form.duration_minutes}
                  onChange={(e) =>
                    setForm({ ...form, duration_minutes: Number(e.target.value) || 30 })
                  }
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Buffer (min)</Label>
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={form.buffer_minutes}
                  onChange={(e) =>
                    setForm({ ...form, buffer_minutes: Number(e.target.value) || 0 })
                  }
                  className="h-9"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Antecedência mín (h)</Label>
                <Input
                  type="number"
                  min={0}
                  max={168}
                  value={form.min_advance_hours}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      min_advance_hours: Number(e.target.value) || 0,
                    })
                  }
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Localização</Label>
                <select
                  value={form.location_type}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      location_type: e.target.value as AppointmentLocationType,
                    })
                  }
                  className={cn(
                    'h-9 w-full rounded-md border border-input bg-background px-3 text-sm',
                    'focus:outline-none focus:ring-2 focus:ring-ring',
                  )}
                >
                  <option value="online">Online (Meet/Zoom)</option>
                  <option value="presencial">Presencial</option>
                  <option value="telefone">Telefone</option>
                  <option value="flexivel">Flexível</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Detalhes da localização</Label>
                <Input
                  value={form.location_details}
                  onChange={(e) =>
                    setForm({ ...form, location_details: e.target.value })
                  }
                  placeholder={
                    form.location_type === 'online'
                      ? 'Link da reunião'
                      : 'Endereço completo'
                  }
                  maxLength={500}
                  className="h-9"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <Label className="text-[11px]">Máximo por dia (por agente)</Label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={form.max_per_day}
                  onChange={(e) =>
                    setForm({ ...form, max_per_day: Number(e.target.value) || 10 })
                  }
                  className="h-9"
                />
              </div>
              <div className="flex items-end gap-2 pb-1">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={form.is_active}
                  onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
                  className="h-4 w-4 rounded border-input"
                />
                <Label htmlFor="is_active" className="text-[11px] cursor-pointer">
                  Tipo ativo (disponível pra novos agendamentos)
                </Label>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-border pt-4">
              <div className="flex items-center gap-2">
                <Sliders className="h-3.5 w-3.5 text-cyan-500" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Campos personalizados
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                Configure campos extras a coletar do cliente quando ele agendar.
                Genérico por nicho — clínica usa peso/convênio, oficina usa
                marca/modelo, salão usa comprimento/alergia, etc.
              </p>
              <CustomFieldsSchemaEditor
                schema={form.custom_fields_schema}
                onChange={(custom_fields_schema) =>
                  setForm({ ...form, custom_fields_schema })
                }
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {editing ? 'Salvar alterações' : 'Criar tipo'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
