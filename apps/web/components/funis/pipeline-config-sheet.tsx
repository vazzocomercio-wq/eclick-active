'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('funis.pipelineSheet');
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
            : t('errors.reorder'),
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
            : t('errors.update'),
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
            : t('errors.delete'),
      );
    }
  }

  async function handleStageCreate() {
    if (!pipeline) return;
    setError(null);
    try {
      const created = await pipelinesApi.createStage(pipeline.id, {
        name: t('newStageDefaultName'),
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
      // Persiste a ordem (move para antes de Ganho/Perdido). Backend
      // auto-normaliza terminais pro fim — não vai mais falhar por
      // ordem, mas reportamos qualquer outro erro (ex: mismatch).
      try {
        await pipelinesApi.reorderStages(
          pipeline.id,
          next.map((s) => s.id),
        );
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : err instanceof Error
              ? err.message
              : t('errors.position'),
        );
      }
      onChange();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('errors.create'),
      );
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 sm:max-w-xl" side="right">
        <SheetHeader className="border-b border-border pb-4">
          <SheetTitle>{t('title')}</SheetTitle>
          <SheetDescription>
            {pipeline?.name ?? t('selectFallback')} · {t('subtitleSuffix')}
            {savingReorder && ` · ${t('savingSuffix')}`}
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
            {t('addStage')}
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
              result.moved === 1
                ? t('moveDialog.successOne', { count: result.moved })
                : t('moveDialog.successMany', { count: result.moved }),
            );
            setStages((curr) => curr.filter((s) => s.id !== moveAndDelete.stage.id));
            setMoveAndDelete(null);
            onChange();
          } catch (err) {
            toast.error(t('moveDialog.failed'), {
              description:
                err instanceof ApiError
                  ? `${err.status}: ${err.message}`
                  : err instanceof Error
                    ? err.message
                    : t('moveDialog.unknownError'),
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
  const t = useTranslations('funis.pipelineSheet.moveDialog');
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
          <DialogTitle>{t('title', { name: sourceStage.name })}</DialogTitle>
          <DialogDescription>
            {sourceStage.deal_count === 1
              ? t('descriptionOne', { count: sourceStage.deal_count })
              : t('descriptionMany', { count: sourceStage.deal_count })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label className="text-xs">{t('targetLabel')}</Label>
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={submitting}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {otherStages.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_won ? ` ${t('wonSuffix')}` : s.is_lost ? ` ${t('lostSuffix')}` : ''}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            {t('cancel')}
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
            {t('confirm')}
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
  const t = useTranslations('funis.pipelineSheet.row');
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
          aria-label={t('dragLabel')}
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
            {stage.probability}% · {stage.sla_hours ? t('slaSuffix', { hours: stage.sla_hours }) : t('noSla')}
            {stage.deal_count > 0 && ` · ${stage.deal_count === 1 ? t('dealsOne', { count: stage.deal_count }) : t('dealsMany', { count: stage.deal_count })}`}
            {isProtected && ` · ${t('protected')}`}
          </span>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenAutomations}
          title={t('automationsTitle')}
          className="h-7 px-2 text-xs text-primary hover:bg-primary/10"
        >
          <Zap className="mr-1 h-3 w-3" />
          {t('automations')}
        </Button>
        {!isProtected && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setEditing((v) => !v)}
          >
            {editing ? t('close') : t('edit')}
          </Button>
        )}
      </div>

      {editing && (
        <div className="grid grid-cols-2 gap-3 border-t border-border bg-muted/20 p-3">
          <SmallField label={t('name')} className="col-span-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </SmallField>

          <SmallField label={t('color')}>
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

          <SmallField label={t('probability')}>
            <Input
              type="number"
              min={0}
              max={100}
              value={probability}
              onChange={(e) => setProbability(e.target.value)}
            />
          </SmallField>

          <SmallField label={t('slaHours')} className="col-span-2">
            <Input
              type="number"
              min={1}
              value={slaHours}
              onChange={(e) => setSlaHours(e.target.value)}
              placeholder={t('slaPlaceholder')}
            />
          </SmallField>

          {/* Bloco G: required fields */}
          <div className="col-span-2 flex flex-col gap-2 rounded-md border border-dashed border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Sparkles className="h-3 w-3 text-primary" />
              <span className="font-semibold">{t('requiredTitle')}</span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {t('requiredHint')}
            </p>

            <RequiredFieldsToggleList
              label={t('requiredContact')}
              kind="contact"
              values={requiredContact}
              onChange={setRequiredContact}
            />
            <RequiredFieldsToggleList
              label={t('requiredDeal')}
              kind="deal"
              values={requiredDeal}
              onChange={setRequiredDeal}
            />
          </div>

          <div className="col-span-2 flex items-center justify-between gap-2 pt-1">
            {confirmDelete ? (
              <div className="flex items-center gap-1 text-[11px]">
                <span className="text-destructive">{t('confirmDelete')}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2"
                  onClick={handleDelete}
                  disabled={saving}
                >
                  {t('yes')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2"
                  onClick={() => setConfirmDelete(false)}
                >
                  {t('no')}
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
                {t('delete')}
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
                    <Check className="mr-1 h-3.5 w-3.5" /> {t('save')}
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

const CONTACT_FIELD_VALUES = ['name', 'email', 'phone', 'company_name'] as const;
const DEAL_FIELD_VALUES = ['value', 'expected_close_date'] as const;
type ContactFieldValue = typeof CONTACT_FIELD_VALUES[number];
type DealFieldValue = typeof DEAL_FIELD_VALUES[number];

function RequiredFieldsToggleList({
  label,
  kind,
  values,
  onChange,
}: {
  label: string;
  kind: 'contact' | 'deal';
  values: string[];
  onChange: (v: string[]) => void;
}) {
  const tContact = useTranslations('funis.pipelineSheet.contactFields');
  const tDeal = useTranslations('funis.pipelineSheet.dealFields');
  const options: ReadonlyArray<string> =
    kind === 'contact' ? CONTACT_FIELD_VALUES : DEAL_FIELD_VALUES;
  function labelFor(v: string): string {
    return kind === 'contact'
      ? tContact(v as ContactFieldValue)
      : tDeal(v as DealFieldValue);
  }
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
        {options.map((value) => {
          const active = values.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                active
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border bg-card text-muted-foreground hover:border-primary/30',
              )}
            >
              {labelFor(value)}
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
