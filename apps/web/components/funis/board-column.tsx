'use client';

import { Plus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BoardDealItem, BoardStageGroup } from '@/lib/api/pipelines';
import { DealCard } from './deal-card';
import { cn } from '@/lib/utils';

interface BoardColumnProps {
  stage: BoardStageGroup;
  onAddDeal: (stageId: string) => void;
  onSelectDeal: (deal: BoardDealItem) => void;
}

export function BoardColumn({ stage, onAddDeal, onSelectDeal }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({
    id: `column:${stage.id}`,
    data: { type: 'column', stageId: stage.id },
  });

  const dealIds = stage.deals.map((d) => d.id);

  return (
    <div
      className={cn(
        'flex h-full w-[300px] shrink-0 flex-col rounded-lg border border-border bg-card/30',
      )}
    >
      {/* Header da coluna */}
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: stage.color }}
            aria-hidden
          />
          <h3 className="truncate text-sm font-semibold tracking-tight">{stage.name}</h3>
          <span className="shrink-0 text-xs font-medium text-muted-foreground tabular-nums">
            {stage.deals_count}
          </span>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          {formatBRL(stage.total_value)}
        </span>
      </header>

      {/* Drop zone */}
      <ScrollArea
        className={cn(
          'flex-1 transition-colors',
          isOver && 'bg-primary/5',
        )}
      >
        <div
          ref={setNodeRef}
          className="flex min-h-full flex-col gap-2 p-2"
          aria-label={`Coluna ${stage.name}`}
        >
          <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
            {stage.deals.length === 0 ? (
              <EmptyColumn isOver={isOver} />
            ) : (
              stage.deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} onSelect={() => onSelectDeal(deal)} />
              ))
            )}
          </SortableContext>
        </div>
      </ScrollArea>

      {/* Footer com botão adicionar */}
      <footer className="border-t border-border p-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onAddDeal(stage.id)}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Adicionar negócio
        </Button>
      </footer>
    </div>
  );
}

function EmptyColumn({ isOver }: { isOver: boolean }) {
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center rounded-md border border-dashed border-border/50 p-6 text-xs text-muted-foreground',
        isOver && 'border-primary/50 bg-primary/5 text-primary',
      )}
    >
      {isOver ? 'Solte aqui' : 'Sem negócios'}
    </div>
  );
}

function formatBRL(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '—';
  return n.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
