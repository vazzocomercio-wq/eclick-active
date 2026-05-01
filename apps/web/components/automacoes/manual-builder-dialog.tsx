'use client';

import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Loader2, Plus, X } from 'lucide-react';
import type { AutomationTriggerType } from '@eclick-active/shared';
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
import {
  automationsApi,
  type Automation,
  type AutomationAction,
  type AutomationActionType,
} from '@/lib/api/automations';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import {
  ACTION_OPTIONS,
  ActionIcon,
  TRIGGER_OPTIONS,
  actionLabel,
  triggerLabel,
} from './automation-icons';

interface ManualBuilderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Se passado, modo edição. */
  existing?: Automation | null;
  onSaved: () => void;
}

const CHANNEL_TYPES = [
  '',
  'whatsapp',
  'instagram',
  'messenger',
  'telegram',
  'email',
  'webchat',
];

const INTENTS = [
  '',
  'budget',
  'question',
  'complaint',
  'negotiation',
  'support',
  'greeting',
];

export function ManualBuilderDialog({
  open,
  onOpenChange,
  existing,
  onSaved,
}: ManualBuilderDialogProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [triggerType, setTriggerType] = useState<AutomationTriggerType>('message_received');
  const [triggerConfig, setTriggerConfig] = useState<Record<string, string>>({});
  const [actions, setActions] = useState<AutomationAction[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setName(existing.name);
      setDescription(existing.description ?? '');
      setTriggerType(existing.trigger_type);
      setTriggerConfig(
        Object.fromEntries(
          Object.entries(existing.trigger_config ?? {}).map(([k, v]) => [k, String(v ?? '')]),
        ),
      );
      setActions(existing.actions);
    } else {
      setName('');
      setDescription('');
      setTriggerType('message_received');
      setTriggerConfig({});
      setActions([
        {
          type: 'send_message',
          text: '',
        },
      ]);
    }
    setError(null);
  }, [open, existing]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = Number(active.id);
    const newIdx = Number(over.id);
    setActions((curr) => arrayMove(curr, oldIdx, newIdx));
  }

  function addAction(type: AutomationActionType) {
    setActions((curr) => [...curr, defaultActionFor(type)]);
  }

  function updateAction(idx: number, patch: Partial<AutomationAction>) {
    setActions((curr) =>
      curr.map((a, i) => (i === idx ? { ...a, ...patch } : a)),
    );
  }

  function removeAction(idx: number) {
    setActions((curr) => curr.filter((_, i) => i !== idx));
  }

  async function handleSave() {
    if (!name.trim() || actions.length === 0) return;
    setSubmitting(true);
    setError(null);

    // Limpa keys vazias do trigger_config
    const cleanedConfig: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(triggerConfig)) {
      if (v && v.trim()) cleanedConfig[k] = v.trim();
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      trigger_type: triggerType,
      trigger_config: cleanedConfig,
      actions: actions.map(stripEmpty),
    };

    try {
      if (existing) {
        await automationsApi.update(existing.id, payload);
      } else {
        await automationsApi.create({ ...payload, is_active: false });
      }
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao salvar',
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{existing ? 'Editar automação' : 'Nova automação'}</DialogTitle>
          <DialogDescription>
            Configure o disparador e as ações na ordem de execução.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Nome + descrição */}
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Nome <span className="text-destructive">*</span></Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Boas-vindas WhatsApp"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Descrição</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opcional"
              rows={2}
            />
          </div>

          {/* Trigger */}
          <section className="flex flex-col gap-2 rounded-xl border border-border bg-card/50 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Disparador
            </h3>
            <select
              value={triggerType}
              onChange={(e) => {
                setTriggerType(e.target.value as AutomationTriggerType);
                setTriggerConfig({});
              }}
              className={cn(
                'h-10 w-full rounded-md border border-input bg-background px-3 text-sm',
                'focus:outline-none focus:ring-2 focus:ring-ring',
              )}
            >
              {TRIGGER_OPTIONS.map((t) => (
                <option key={t} value={t}>
                  {triggerLabel(t)}
                </option>
              ))}
            </select>

            <TriggerConfigFields
              type={triggerType}
              config={triggerConfig}
              onChange={(next) => setTriggerConfig(next)}
            />
          </section>

          {/* Ações */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Ações ({actions.length})
              </h3>
            </div>

            {actions.length === 0 ? (
              <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                Nenhuma ação ainda. Adicione abaixo.
              </p>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={actions.map((_, i) => String(i))}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col gap-2">
                    {actions.map((action, idx) => (
                      <SortableActionRow
                        key={`${action.type}-${idx}`}
                        idx={idx}
                        action={action}
                        onChange={(patch) => updateAction(idx, patch)}
                        onRemove={() => removeAction(idx)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}

            {/* Add action picker */}
            <div className="flex flex-wrap gap-1.5 pt-1">
              {ACTION_OPTIONS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => addAction(t)}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[11px]',
                    'transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary',
                  )}
                >
                  <Plus className="h-3 w-3" />
                  {actionLabel(t)}
                </button>
              ))}
            </div>
          </section>

          {error && (
            <p className="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
          >
            Cancelar
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting || !name.trim() || actions.length === 0}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {submitting ? 'Salvando...' : existing ? 'Salvar' : 'Criar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// SortableActionRow
// ──────────────────────────────────────────────────────────

function SortableActionRow({
  idx,
  action,
  onChange,
  onRemove,
}: {
  idx: number;
  action: AutomationAction;
  onChange: (patch: Partial<AutomationAction>) => void;
  onRemove: () => void;
}) {
  const id = String(idx);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="rounded-lg border border-border bg-card"
    >
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="mt-0.5 cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Arrastar"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tabular-nums">
          {idx + 1}
        </span>

        <ActionIcon type={action.type} className="mt-0.5 shrink-0" />

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span className="text-xs font-medium">{actionLabel(action.type)}</span>
          <ActionConfigFields action={action} onChange={onChange} />
        </div>

        <button
          type="button"
          onClick={onRemove}
          className="text-muted-foreground hover:text-destructive"
          aria-label="Remover ação"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

// ──────────────────────────────────────────────────────────
// Trigger config fields (dynamic per type)
// ──────────────────────────────────────────────────────────

function TriggerConfigFields({
  type,
  config,
  onChange,
}: {
  type: AutomationTriggerType;
  config: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}) {
  function update(key: string, value: string) {
    onChange({ ...config, [key]: value });
  }

  if (type === 'message_received') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <SmallField label="Canal">
          <select
            value={config.channel_type ?? ''}
            onChange={(e) => update('channel_type', e.target.value)}
            className={selectClass}
          >
            {CHANNEL_TYPES.map((c) => (
              <option key={c} value={c}>
                {c || 'Qualquer'}
              </option>
            ))}
          </select>
        </SmallField>

        <SmallField label="Intent (IA)">
          <select
            value={config.intent ?? ''}
            onChange={(e) => update('intent', e.target.value)}
            className={selectClass}
          >
            {INTENTS.map((i) => (
              <option key={i} value={i}>
                {i || 'Qualquer'}
              </option>
            ))}
          </select>
        </SmallField>

        <SmallField label="Mensagem contém" className="sm:col-span-2">
          <Input
            value={config.contains_text ?? ''}
            onChange={(e) => update('contains_text', e.target.value)}
            placeholder="Ex: preço, orçamento"
            className="h-8 text-xs"
          />
        </SmallField>
      </div>
    );
  }

  if (type === 'deal_stage_changed') {
    return (
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SmallField label="Pipeline ID">
          <Input
            value={config.pipeline_id ?? ''}
            onChange={(e) => update('pipeline_id', e.target.value)}
            placeholder="UUID (opcional)"
            className="h-8 font-mono text-[11px]"
          />
        </SmallField>
        <SmallField label="De stage">
          <Input
            value={config.from_stage_id ?? ''}
            onChange={(e) => update('from_stage_id', e.target.value)}
            placeholder="UUID"
            className="h-8 font-mono text-[11px]"
          />
        </SmallField>
        <SmallField label="Para stage">
          <Input
            value={config.to_stage_id ?? ''}
            onChange={(e) => update('to_stage_id', e.target.value)}
            placeholder="UUID"
            className="h-8 font-mono text-[11px]"
          />
        </SmallField>
      </div>
    );
  }

  if (type === 'contact_created') {
    return (
      <SmallField label="Origem">
        <select
          value={config.source ?? ''}
          onChange={(e) => update('source', e.target.value)}
          className={selectClass}
        >
          <option value="">Qualquer</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="instagram">Instagram</option>
          <option value="website">Website</option>
          <option value="import">Import</option>
          <option value="manual">Manual</option>
          <option value="referral">Referral</option>
        </select>
      </SmallField>
    );
  }

  if (type === 'task_overdue') {
    return (
      <SmallField label="Tipo de tarefa">
        <select
          value={config.task_type ?? ''}
          onChange={(e) => update('task_type', e.target.value)}
          className={selectClass}
        >
          <option value="">Qualquer</option>
          <option value="call">Ligação</option>
          <option value="email">Email</option>
          <option value="meeting">Reunião</option>
          <option value="follow_up">Follow-up</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="proposal">Proposta</option>
        </select>
      </SmallField>
    );
  }

  return null; // manual / time_based: sem config
}

// ──────────────────────────────────────────────────────────
// Action config fields (dynamic per type)
// ──────────────────────────────────────────────────────────

function ActionConfigFields({
  action,
  onChange,
}: {
  action: AutomationAction;
  onChange: (patch: Partial<AutomationAction>) => void;
}) {
  if (action.type === 'send_message') {
    return (
      <Textarea
        value={action.text ?? ''}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder="Olá {{contact.first_name}}, ..."
        rows={2}
        className="text-xs"
      />
    );
  }

  if (action.type === 'create_task') {
    return (
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <Input
          value={action.title ?? ''}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="Título da tarefa"
          className="h-8 text-xs sm:col-span-3"
        />
        <select
          value={action.task_type ?? 'follow_up'}
          onChange={(e) => onChange({ task_type: e.target.value })}
          className={cn(selectClass, 'h-8')}
        >
          <option value="follow_up">Follow-up</option>
          <option value="call">Ligação</option>
          <option value="email">Email</option>
          <option value="meeting">Reunião</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="proposal">Proposta</option>
        </select>
        <select
          value={action.priority ?? 'normal'}
          onChange={(e) =>
            onChange({ priority: e.target.value as AutomationAction['priority'] })
          }
          className={cn(selectClass, 'h-8')}
        >
          <option value="low">Baixa</option>
          <option value="normal">Normal</option>
          <option value="high">Alta</option>
          <option value="urgent">Urgente</option>
        </select>
        <Input
          type="number"
          min={0}
          value={action.due_in_hours ?? ''}
          onChange={(e) =>
            onChange({ due_in_hours: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="Horas até prazo"
          className="h-8 text-xs"
        />
      </div>
    );
  }

  if (action.type === 'move_deal') {
    return (
      <Input
        value={action.to_stage_id ?? ''}
        onChange={(e) => onChange({ to_stage_id: e.target.value })}
        placeholder="UUID do stage de destino"
        className="h-8 font-mono text-[11px]"
      />
    );
  }

  if (action.type === 'update_contact') {
    return (
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-3">
        <Input
          value={(action.add_tags ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              add_tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="Tags +"
          className="h-8 text-xs"
        />
        <Input
          value={(action.remove_tags ?? []).join(', ')}
          onChange={(e) =>
            onChange({
              remove_tags: e.target.value
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            })
          }
          placeholder="Tags −"
          className="h-8 text-xs"
        />
        <select
          value={action.temperature ?? ''}
          onChange={(e) =>
            onChange({
              temperature: (e.target.value as AutomationAction['temperature']) || undefined,
            })
          }
          className={cn(selectClass, 'h-8')}
        >
          <option value="">Manter temperatura</option>
          <option value="cold">Cold</option>
          <option value="warm">Warm</option>
          <option value="hot">Hot</option>
          <option value="very_hot">Very hot</option>
        </select>
      </div>
    );
  }

  if (action.type === 'assign_conversation') {
    return (
      <Input
        value={action.assigned_to ?? ''}
        onChange={(e) => onChange({ assigned_to: e.target.value })}
        placeholder="UUID do agente"
        className="h-8 font-mono text-[11px]"
      />
    );
  }

  if (action.type === 'notify_agent') {
    return (
      <Textarea
        value={action.message ?? ''}
        onChange={(e) => onChange({ message: e.target.value })}
        placeholder="Texto da notificação"
        rows={2}
        className="text-xs"
      />
    );
  }

  if (action.type === 'wait') {
    return (
      <Input
        type="number"
        min={0}
        max={5}
        value={action.minutes ?? 0}
        onChange={(e) => onChange({ minutes: Number(e.target.value) })}
        placeholder="Minutos (máx 5)"
        className="h-8 text-xs"
      />
    );
  }

  return null;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

const selectClass =
  'w-full rounded-md border border-input bg-background px-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring';

function SmallField({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function defaultActionFor(type: AutomationActionType): AutomationAction {
  switch (type) {
    case 'send_message':
      return { type, text: '' };
    case 'create_task':
      return { type, title: '', task_type: 'follow_up', priority: 'normal' };
    case 'move_deal':
      return { type, to_stage_id: '' };
    case 'update_contact':
      return { type };
    case 'assign_conversation':
      return { type, assigned_to: '' };
    case 'notify_agent':
      return { type, message: '' };
    case 'wait':
      return { type, minutes: 1 };
  }
}

function stripEmpty(action: AutomationAction): AutomationAction {
  const next: AutomationAction = { type: action.type };
  for (const [k, v] of Object.entries(action as unknown as Record<string, unknown>)) {
    if (k === 'type') continue;
    if (v === '' || v === null || v === undefined) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    (next as unknown as Record<string, unknown>)[k] = v;
  }
  return next;
}
