'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { BoardDealItem, BoardStageGroup } from '@/lib/api/pipelines';
import { DealCard } from './deal-card';
import { QuickAddDeal } from './quick-add-deal';
import { cn } from '@/lib/utils';

interface BoardColumnProps {
  stage: BoardStageGroup;
  pipelineId: string;
  onSelectDeal: (deal: BoardDealItem) => void;
  /** Disparado quando um deal é criado pelo quick-add inline. */
  onChanged: () => void | Promise<void>;
}

export function BoardColumn({
  stage,
  pipelineId,
  onSelectDeal,
  onChanged,
}: BoardColumnProps) {
  const t = useTranslations('funis.board.column');
  const isClosingColumn = stage.is_won || stage.is_lost;
  const [quickAddOpen, setQuickAddOpen] = useState(false);

  // Colunas Ganho/Perdido começam colapsadas — agente foca em deals ativos
  const [collapsed, setCollapsed] = useState(isClosingColumn);

  const { setNodeRef, isOver } = useDroppable({
    id: `column:${stage.id}`,
    data: { type: 'column', stageId: stage.id },
  });

  const dealIds = stage.deals.map((d) => d.id);

  // Quando colapsada, mostra só o header vertical com nome rotacionado
  if (collapsed) {
    return (
      <CollapsedColumn
        stage={stage}
        setNodeRef={setNodeRef}
        isOver={isOver}
        onExpand={() => setCollapsed(false)}
      />
    );
  }

  // Versão expandida: mantém os mesmos visuais com botão de colapsar (só
  // disponível em colunas Ganho/Perdido — colunas normais não colapsam).
  return (
    <div
      className={cn(
        'flex h-full w-[300px] shrink-0 flex-col rounded-lg border border-border bg-card/30',
      )}
    >
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
        <div className="flex items-center gap-1">
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {formatBRL(stage.total_value)}
          </span>
          {!isClosingColumn && (
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              aria-label={t('addDeal')}
              title={t('addDealQuick')}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {isClosingColumn && (
            <button
              type="button"
              onClick={() => setCollapsed(true)}
              aria-label={t('collapseColumn')}
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ChevronRight className="h-3 w-3" />
            </button>
          )}
        </div>
      </header>

      {/* Quick-add inline — slide-down quando aberto */}
      {quickAddOpen && !isClosingColumn && (
        <div className="border-b border-border p-2">
          <QuickAddDeal
            pipelineId={pipelineId}
            stageId={stage.id}
            onCreated={async () => {
              setQuickAddOpen(false);
              await onChanged();
            }}
            onCancel={() => setQuickAddOpen(false)}
          />
        </div>
      )}

      <ScrollArea className={cn('flex-1 transition-colors', isOver && 'bg-primary/5')}>
        <div
          ref={setNodeRef}
          className="flex min-h-full flex-col gap-2 p-2"
          aria-label={t('ariaColumn', { name: stage.name })}
        >
          <SortableContext items={dealIds} strategy={verticalListSortingStrategy}>
            {stage.deals.length === 0 ? (
              <EmptyColumn isOver={isOver} />
            ) : (
              // Em closing columns, mostramos só os 10 mais recentes pra não
              // poluir o board com todos os deals históricos.
              (isClosingColumn ? stage.deals.slice(0, 10) : stage.deals).map((deal) => (
                <DealCard key={deal.id} deal={deal} onSelect={() => onSelectDeal(deal)} />
              ))
            )}
            {isClosingColumn && stage.deals.length > 10 && (
              <p className="px-2 py-1 text-center text-[11px] text-muted-foreground">
                {t('moreSuffix', { count: stage.deals.length - 10 })}
              </p>
            )}
          </SortableContext>
        </div>
      </ScrollArea>

      {!isClosingColumn && !quickAddOpen && (
        <footer className="border-t border-border p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setQuickAddOpen(true)}
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            {t('addDeal')}
          </Button>
        </footer>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// CollapsedColumn — versão de 80px com header vertical
// ──────────────────────────────────────────────────────────

function CollapsedColumn({
  stage,
  setNodeRef,
  isOver,
  onExpand,
}: {
  stage: BoardStageGroup;
  setNodeRef: (el: HTMLElement | null) => void;
  isOver: boolean;
  onExpand: () => void;
}) {
  const t = useTranslations('funis.board.column');
  return (
    <div
      ref={setNodeRef}
      onClick={onExpand}
      role="button"
      aria-label={t('expandColumn', { name: stage.name })}
      className={cn(
        'group relative flex h-full w-[80px] shrink-0 cursor-pointer flex-col items-center justify-between rounded-lg border border-border bg-card/30 py-3 transition-colors',
        'hover:border-primary/30 hover:bg-card/60',
        isOver && 'border-primary/60 bg-primary/5',
      )}
    >
      {/* Topo: chevron pra expandir */}
      <ChevronLeft className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-foreground" />

      {/* Centro: nome rotacionado + contagem */}
      <div className="flex flex-col items-center gap-2 [writing-mode:vertical-rl] [text-orientation:mixed]">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: stage.color, writingMode: 'horizontal-tb' }}
          aria-hidden
        />
        <h3 className="truncate text-sm font-semibold tracking-tight">{stage.name}</h3>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          {stage.deals_count}
        </span>
      </div>

      {/* Base: valor total */}
      <span className="px-1 text-center text-[10px] text-muted-foreground tabular-nums">
        {formatBRL(stage.total_value)}
      </span>
    </div>
  );
}

function EmptyColumn({ isOver }: { isOver: boolean }) {
  const t = useTranslations('funis.board.column');
  return (
    <div
      className={cn(
        'flex flex-1 items-center justify-center rounded-md border border-dashed border-border/50 p-6 text-xs text-muted-foreground',
        isOver && 'border-primary/50 bg-primary/5 text-primary',
      )}
    >
      {isOver ? t('dropHere') : t('noDeals')}
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
