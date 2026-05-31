'use client';

import { useEffect, useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import {
  cortesApi,
  CLIP_STATUS_ORDER,
  DROPPABLE_STATUSES,
  type BoardColumns,
  type ClipRow,
  type ClipStatus,
} from '@/lib/api/studio-cortes';
import { ApiError } from '@/lib/api/client';
import { CortesColumn } from './cortes-column';
import { ClipCardVisual, STATUS_META } from './clip-card';
import { ClipDetailSheet } from './clip-detail-sheet';

interface CortesBoardProps {
  columns: BoardColumns;
  onRefresh: () => void;
}

export function CortesBoard({ columns, onRefresh }: CortesBoardProps) {
  const [cols, setCols] = useState<BoardColumns>(columns);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selected, setSelected] = useState<ClipRow | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Sincroniza com o servidor quando o pai recarrega.
  useEffect(() => setCols(columns), [columns]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const activeClip = activeId ? findClip(cols, activeId)?.clip ?? null : null;

  function handleDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }

  async function handleDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;

    const found = findClip(cols, String(active.id));
    if (!found) return;
    const source = found.status;

    const overId = String(over.id);
    const target: ClipStatus = overId.startsWith('column:')
      ? (overId.slice('column:'.length) as ClipStatus)
      : findClip(cols, overId)?.status ?? source;

    if (!DROPPABLE_STATUSES.includes(target)) {
      toast.info(
        target === 'publicado'
          ? 'A coluna Publicado é automática — aprove o corte que o sistema publica.'
          : 'Esta coluna é definida pelo sistema.',
      );
      return;
    }

    if (source === target) {
      // Reordena dentro da mesma coluna (visual; ordem não é persistida).
      const list = cols[source];
      const fromIdx = found.index;
      const toIdx = overId.startsWith('column:')
        ? list.length - 1
        : list.findIndex((c) => c.id === overId);
      if (fromIdx !== toIdx && toIdx >= 0) {
        setCols({ ...cols, [source]: arrayMove(list, fromIdx, toIdx) });
      }
      return;
    }

    // Move entre colunas — otimista + persiste.
    const prev = cols;
    const moving = found.clip;
    const next: BoardColumns = {
      ...cols,
      [source]: cols[source].filter((c) => c.id !== moving.id),
      [target]: [{ ...moving, status: target }, ...cols[target]],
    };
    setCols(next);

    try {
      await cortesApi.setClipStatus(moving.id, target);
      toast.success(`Movido para "${STATUS_META[target].label}".`);
    } catch (err) {
      setCols(prev); // reverte
      toast.error('Não consegui mover o corte', {
        description: err instanceof ApiError ? err.message : String(err),
      });
      onRefresh();
    }
  }

  function openClip(clip: ClipRow) {
    setSelected(clip);
    setSheetOpen(true);
  }

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex h-full gap-3 overflow-x-auto pb-2">
          {CLIP_STATUS_ORDER.map((status) => (
            <CortesColumn
              key={status}
              status={status}
              clips={cols[status] ?? []}
              droppable={DROPPABLE_STATUSES.includes(status)}
              onSelectClip={openClip}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={{ duration: 200, easing: 'ease-out' }}>
          {activeClip ? (
            <div className="w-[284px]">
              <ClipCardVisual clip={activeClip} isOverlay />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      <ClipDetailSheet
        clip={selected}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onChanged={onRefresh}
      />
    </>
  );
}

function findClip(
  cols: BoardColumns,
  id: string,
): { clip: ClipRow; status: ClipStatus; index: number } | null {
  for (const status of CLIP_STATUS_ORDER) {
    const list = cols[status] ?? [];
    const index = list.findIndex((c) => c.id === id);
    if (index >= 0) return { clip: list[index]!, status, index };
  }
  return null;
}
