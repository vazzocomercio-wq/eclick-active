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
import {
  Check,
  GripVertical,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
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
import {
  pipelinesApi,
  type PipelineStageWithCount,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import { StageAutomationsSheet } from './stage-automations-sheet';
import { cn } from '@/lib/utils';

interface PipelineConfigSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: PipelineWithStages | null;
  /** Chamado quando algo muda — page deve recarregar pipelines + board */
  onChange: () => void;
}

export function PipelineConfigSheet({
  open,
  onOpenChange,
  pipeline,
  onChange,
}: PipelineConfigSheetProps) {
  const [stages, setStages] = useState<PipelineStageWithCount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [savingReorder, setSavingReorder] = useState(false);
  // Dialog "Mover e deletar" — quando user tenta apagar stage com deals
  const [moveAndDelete, setMoveAndDelete] = useState<{
    stage: PipelineStageWithCount;
  } | null>(null);
  // Sheet de automações por stage (Funil Digital)
  const [automationsStage, setAutomationsStage] = useState<PipelineStageWithCount | null>(null);

  useEffect(() => {
    if (open && pipeline) {
      setStages(pipeline.stages);
      setError(null);
    }
  }, [open, pipeline]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!pipeline || !over || active.id === over.id) return;

    const oldIndex = stages.findIndex((s) => s.id === active.id);
    const newIndex = stages.findIndex((s) => s.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(stages, oldIndex, newIndex);
    setStages(reordered);
    setSavingReorder(true);
    setError(null);

    try {
      await pipelinesApi.reorderStages(
        pipeline.id,
        reordered.map((s) => s.id),
      );
      onChange();
    } catch (err) {
      // Reverte
      setStages(stages);
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao reordenar',
      );
    } finally {
      setSavingReorder(false);
    }
  }

  async function handleStageUpdate(
    stageId: string,
    patch: Parameters<typeof pipelinesApi.updateStage>[2],
  ) {
    if (!pipeline) return;
    setError(null);
    try {
      const updated = await pipelinesApi.updateStage(pipeline.id, stageId, patch);
      setStages((curr) =>
        curr.map((s) => (s.id === stageId ? { ...s, ...updated } : s)),
      );
      onChange();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao atualizar stage',
      );
    }
  }

  async function handleStageDelete(stageId: string) {
    if (!pipeline) return;
    // Se o stage tem deals, abre dialog de transferência em vez de deletar.
    const stage = stages.find((s) => s.id === stageId);
    if (stage && stage.deal_count > 0) {
      setMoveAndDelete({ stage });
      return;
    }
    setError(null);
    try {
      await pipelinesApi.removeStage(pipeline.id, stageId);
      setStages((curr) => curr.filter((s) => s.id !== stageId));
      onChange();
    } catch (err) {
      // Pode ainda dar 409 se houver deals criados em paralelo — fallback
      // pro dialog de transferência.
      if (err instanceof ApiError && err.status === 409 && stage) {
        setMoveAndDelete({ stage });
        return;
      }
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao deletar stage',
      );
    }
  }

  async function handleStageCreate() {
    if (!pipeline) return;
    setError(null);
    try {
      const created = await pipelinesApi.createStage(pipeline.id, {
        name: 'Nova etapa',
        color: '#00E5FF',
        probability: 0,
      });
      // Ganho/Perdido devem ficar no final — insere o novo antes deles
      const lastNormalIdx = stages.findIndex((s) => s.is_won || s.is_lost);
      const next = [...stages];
      if (lastNormalIdx === -1) {
        next.push({ ...created, deal_count: 0 });
      } else {
        next.splice(lastNormalIdx, 0, { ...created, deal_count: 0 });
      }
      setStages(next);
      // Persiste a ordem (move para antes de Ganho/Perdido)
      try {
        await pipelinesApi.reorderStages(
          pipeline.id,
          next.map((s) => s.id),
        );
      } catch {
        // Não-fatal — a UI mostra a ordem desejada; reload externo reconcilia
      }
      onChange();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : 'Erro ao criar stage',
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>Configurar pipeline</SheetTitle>
          <SheetDescription>
            {pipeline?.name ?? 'Selecione um pipeline'} · arraste para reordenar
            {savingReorder && ' · salvando...'}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {error && (
            <div className="mb-3 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}

          {pipeline ? (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={stages.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="flex flex-col gap-2">
                  {stages.map((stage) => (
                    <SortableStageRow
                      key={stage.id}
                      stage={stage}
                      onUpdate={(patch) => handleStageUpdate(stage.id, patch)}
                      onDelete={() => handleStageDelete(stage.id)}
                      onOpenAutomations={() => setAutomationsStage(stage)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ) : null}

          <Button variant="outline" size="sm" className="mt-4 w-full" onClick={handleStageCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            Nova etapa
          </Button>
        </div>
      </SheetContent>

      {/* Sheet "⚡ Automações do stage" (Funil Digital) */}
      <StageAutomationsSheet
        open={automationsStage !== null}
        onOpenChange={(o) => !o && setAutomationsStage(null)}
        stageId={automationsStage?.id ?? null}
        stageName={automationsStage?.name ?? null}
        onChanged={onChange}
      />

      {/* Dialog "Mover e deletar" — pipeline tem deals e usuário quer apagar */}
      <MoveAndDeleteDialog
        open={moveAndDelete !== null}
        sourceStage={moveAndDelete?.stage ?? null}
        otherStages={
          moveAndDelete
            ? stages.filter((s) => s.id !== moveAndDelete.stage.id)
            : []
        }
        onClose={() => setMoveAndDelete(null)}
        onConfirm={async (targetStageId) => {
          if (!pipeline || !moveAndDelete) return;
          try {
            const result = await pipelinesApi.deleteAndMoveStage(
              pipeline.id,
              moveAndDelete.stage.id,
              targetStageId,
            );
            toast.success(
              `Stage excluído — ${result.moved} deal(s) movido(s)`,
            );
            setStages((curr) => curr.filter((s) => s.id !== moveAndDelete.stage.id));
            setMoveAndDelete(null);
            onChange();
          } catch (err) {
            toast.error('Falha ao mover e deletar', {
              description:
                err instanceof ApiError
                  ? `${err.status}: ${err.message}`
                  : err instanceof Error
                    ? err.message
                    : 'Erro desconhecido',
            });
          }
        }}
      />
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────
// MoveAndDeleteDialog
// ──────────────────────────────────────────────────────────

function MoveAndDeleteDialog({
  open,
  sourceStage,
  otherStages,
  onClose,
  onConfirm,
}: {
  open: boolean;
  sourceStage: PipelineStageWithCount | null;
  otherStages: PipelineStageWithCount[];
  onClose: () => void;
  onConfirm: (targetStageId: string) => Promise<void>;
}) {
  const [target, setTarget] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && otherStages.length > 0) {
      setTarget(otherStages[0]!.id);
    }
  }, [open, otherStages]);

  if (!sourceStage) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mover deals e excluir &ldquo;{sourceStage.name}&rdquo;?</DialogTitle>
          <DialogDescription>
            Esta etapa tem <strong>{sourceStage.deal_count}</strong>{' '}
            {sourceStage.deal_count === 1 ? 'negócio' : 'negócios'} ativo
            {sourceStage.deal_count === 1 ? '' : 's'}. Escolha pra onde mover antes
            de excluir.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="text-xs">Mover deals para</Label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={submitting}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {otherStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_won ? ' (Ganho)' : s.is_lost ? ' (Perdido)' : ''}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            disabled={!target || submitting}
            onClick={async () => {
              setSubmitting(true);
              try {
                await onConfirm(target);
              } finally {
                setSubmitting(false);
              }
            }}
          >
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Mover e excluir
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ──────────────────────────────────────────────────────────
// SortableStageRow — uma linha editável + drag handle
// ──────────────────────────────────────────────────────────

interface SortableStageRowProps {
  stage: PipelineStageWithCount;
  onUpdate: (patch: Parameters<typeof pipelinesApi.updateStage>[2]) => Promise<void>;
  onDelete: () => Promise<void>;
  /** Abre a sheet de "⚡ Automações deste stage". */
  onOpenAutomations: () => void;
}

function SortableStageRow({
  stage,
  onUpdate,
  onDelete,
  onOpenAutomations,
}: SortableStageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [probability, setProbability] = useState(String(stage.probability));
  const [slaHours, setSlaHours] = useState(stage.sla_hours?.toString() ?? '');
  const [requiredContact, setRequiredContact] = useState<string[]>(
    stage.required_contact_fields ?? [],
  );
  const [requiredDeal, setRequiredDeal] = useState<string[]>(
    stage.required_deal_fields ?? [],
  );
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset local state quando o stage muda externamente
  useEffect(() => {
    setName(stage.name);
    setColor(stage.color);
    setProbability(String(stage.probability));
    setSlaHours(stage.sla_hours?.toString() ?? '');
    setRequiredContact(stage.required_contact_fields ?? []);
    setRequiredDeal(stage.required_deal_fields ?? []);
  }, [stage]);

  const isProtected = stage.is_won || stage.is_lost;

  async function handleSave() {
    setSaving(true);
    try {
      await onUpdate({
        name: name.trim() || undefined,
        color,
        probability: Number(probability) || 0,
        sla_hours: slaHours.trim() ? Number(slaHours) : null,
        required_contact_fields: requiredContact,
        required_deal_fields: requiredDeal,
      });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setSaving(true);
    try {
      await onDelete();
    } finally {
      setSaving(false);
    }
  }

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border border-border bg-card transition-colors',
        editing && 'border-primary/40',
      )}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab text-muted-foreground hover:text-foreground active:cursor-grabbing"
          aria-label="Arrastar para reordenar"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        <span
          className="h-3 w-3 shrink-0 rounded-full"
          style={{ backgroundColor: stage.color }}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium">{stage.name}</span>
          <span className="truncate text-[11px] text-muted-foreground">
            {stage.probability}% · {stage.sla_hours ? `${stage.sla_hours}h SLA` : 'sem SLA'}
            {stage.deal_count > 0 && ` · ${stage.deal_count} deal${stage.deal_count === 1 ? '' : 's'}`}
            {isProtected && ' · protegido'}
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenAutomations}
          title="Automações deste stage"
          className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
        >
          <Zap className="mr-1 h-3 w-3" />
          Automações
        </Button>
        {!isProtected && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? 'Fechar' : 'Editar'}
          </Button>
        )}
      </div>

      {editing && (
        <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-3">
          <SmallField label="Nome" className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </SmallField>

          <SmallField label="Cor">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="h-9 w-12 cursor-pointer rounded-md border border-input bg-background"
              />
              <Input
                value={color}
                onChange={(e) => setColor(e.target.value.toUpperCase())}
                className="font-mono text-xs uppercase"
                maxLength={7}
              />
            </div>
          </SmallField>

          <SmallField label="Probabilidade (%)">
            <Input
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            />
          </SmallField>

          <SmallField label="SLA (horas)" className="col-span-2">
            <Input
              type="number"
              min={1}
              value={slaHours}
              onChange={(e) => setSlaHours(e.target.value)}
              placeholder="vazio = sem SLA"
            />
          </SmallField>

          {/* Bloco G: required fields */}
          <div className="col-span-2 flex flex-col gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-semibold">Dados obrigatórios neste stage</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              A IA pedirá esses dados ao cliente quando faltarem. Ao receber a resposta, ela extrai
              e atualiza automaticamente.
            </p>

            <RequiredFieldsToggleList
              label="Do contato"
              options={CONTACT_FIELD_OPTIONS}
              values={requiredContact}
              onChange={setRequiredContact}
            />
            <RequiredFieldsToggleList
              label="Do negócio"
              options={DEAL_FIELD_OPTIONS}
              values={requiredDeal}
              onChange={setRequiredDeal}
            />
          </div>

          <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
            {confirmDelete ? (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-destructive">Confirmar?</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  Sim
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => setConfirmDelete(false)}
                >
                  Não
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={saving}
              >
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                Deletar
              </Button>
            )}

            <div className="flex items-center gap-1">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2"
                onClick={() => setEditing(false)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7 px-3"
                onClick={handleSave}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <Check className="mr-1 h-3.5 w-3.5" /> Salvar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

// ──────────────────────────────────────────────────────────
// Required fields config (Bloco G)
// ──────────────────────────────────────────────────────────

const CONTACT_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'name', label: 'Nome' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Telefone' },
  { value: 'company_name', label: 'Empresa' },
];

const DEAL_FIELD_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'value', label: 'Valor' },
  { value: 'expected_close_date', label: 'Previsão fechamento' },
];

function RequiredFieldsToggleList({
  label,
  options,
  values,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  values: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(v: string) {
    if (values.includes(v)) {
      onChange(values.filter((x) => x !== v));
    } else {
      onChange([...values, v]);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = values.includes(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => toggle(opt.value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30',
              )}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
      <Label className="text-[11px] font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
