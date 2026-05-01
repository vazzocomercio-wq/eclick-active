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
  Trash2,
  X,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  pipelinesApi,
  type PipelineStageWithCount,
  type PipelineWithStages,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
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
    setError(null);
    try {
      await pipelinesApi.removeStage(pipeline.id, stageId);
      setStages((curr) => curr.filter((s) => s.id !== stageId));
      onChange();
    } catch (err) {
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
    </Sheet>
  );
}

// ──────────────────────────────────────────────────────────
// SortableStageRow — uma linha editável + drag handle
// ──────────────────────────────────────────────────────────

interface SortableStageRowProps {
  stage: PipelineStageWithCount;
  onUpdate: (patch: Parameters<typeof pipelinesApi.updateStage>[2]) => Promise<void>;
  onDelete: () => Promise<void>;
}

function SortableStageRow({ stage, onUpdate, onDelete }: SortableStageRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: stage.id,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(stage.name);
  const [color, setColor] = useState(stage.color);
  const [probability, setProbability] = useState(String(stage.probability));
  const [slaHours, setSlaHours] = useState(stage.sla_hours?.toString() ?? '');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset local state quando o stage muda externamente
  useEffect(() => {
    setName(stage.name);
    setColor(stage.color);
    setProbability(String(stage.probability));
    setSlaHours(stage.sla_hours?.toString() ?? '');
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
