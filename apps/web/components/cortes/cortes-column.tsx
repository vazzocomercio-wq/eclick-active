'use client';

import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Lock } from 'lucide-react';
import type { ClipRow, ClipStatus } from '@/lib/api/studio-cortes';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { ClipCard, STATUS_META } from './clip-card';

interface CortesColumnProps {
  status: ClipStatus;
  clips: ClipRow[];
  /** false = coluna não aceita drop (publicado = Sprint 2; falhou = sistema). */
  droppable: boolean;
  onSelectClip: (clip: ClipRow) => void;
}

export function CortesColumn({ status, clips, droppable, onSelectClip }: CortesColumnProps) {
  const meta = STATUS_META[status];
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${status}`,
    data: { type: 'column', status },
    disabled: !droppable,
  });

  return (
    <div className="flex h-full w-[300px] shrink-0 flex-col rounded-xl border border-border bg-card">
      {/* Header da coluna */}
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 rounded-full', meta.rule)} />
          <span className="text-sm font-semibold text-foreground">{meta.label}</span>
          <span className="rounded-full bg-muted px-1.5 text-[11px] font-medium text-muted-foreground tabular-nums">
            {clips.length}
          </span>
        </div>
        {!droppable && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground" title="Definido pelo sistema (publica ao aprovar)">
            <Lock className="h-3 w-3" />
          </span>
        )}
      </div>

      {/* Cards */}
      <ScrollArea className={cn('flex-1 transition-colors', isOver && droppable && 'bg-primary/5')}>
        <div ref={setNodeRef} className="flex min-h-[120px] flex-col gap-2 p-2">
          <SortableContext items={clips.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {clips.length === 0 ? (
              <div
                className={cn(
                  'flex flex-1 items-center justify-center rounded-lg border border-dashed border-border px-3 py-8 text-center text-xs text-muted-foreground',
                  isOver && droppable && 'border-primary/50 text-primary',
                )}
              >
                {isOver && droppable ? 'Solte aqui' : 'Vazio'}
              </div>
            ) : (
              clips.map((clip) => (
                <ClipCard key={clip.id} clip={clip} onSelect={() => onSelectClip(clip)} />
              ))
            )}
          </SortableContext>
        </div>
      </ScrollArea>
    </div>
  );
}
