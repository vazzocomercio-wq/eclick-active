'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { AlertTriangle, Inbox } from 'lucide-react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type {
  BoardDealItem,
  BoardFilters,
  BoardStageGroup,
  PipelineWithStages,
} from '@/lib/api/pipelines';
import { pipelinesApi } from '@/lib/api/pipelines';
import { dealsApi } from '@/lib/api/deals';
import { ApiError } from '@/lib/api/client';
import { useBoard } from '@/hooks/use-board';
import { useDragToPan } from '@/hooks/use-drag-to-pan';
import { useEvents } from '@/hooks/use-events';
import { BoardHeader } from '@/components/funis/board-header';
import { BoardColumn } from '@/components/funis/board-column';
import { BoardFiltersBar } from '@/components/funis/board-filters';
import { BoardSearchPalette } from '@/components/funis/board-search-palette';
import { DealCardVisual } from '@/components/funis/deal-card';
import { NewDealDialog } from '@/components/funis/new-deal-dialog';
import { LostReasonDialog } from '@/components/funis/lost-reason-dialog';
import { FunnelAnalysisDialog } from '@/components/funis/funnel-analysis-dialog';
import { DealDetailSheet } from '@/components/funis/deal-detail-sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';

interface PendingMove {
  dealId: string;
  fromStageId: string;
  toStageId: string;
  insertIndex: number;
}

export default function FunisPage() {
  // ── Pipelines (lista + seleção) ──
  const [pipelines, setPipelines] = useState<PipelineWithStages[]>([]);
  const [pipelinesLoading, setPipelinesLoading] = useState(true);
  const [pipelinesError, setPipelinesError] = useState<{ status: number; message: string } | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setPipelinesLoading(true);
    pipelinesApi
      .list()
      .then((list) => {
        if (!alive) return;
        setPipelines(list);
        // Seleciona default ou o primeiro
        const def = list.find((p) => p.is_default) ?? list[0];
        if (def && !selectedId) setSelectedId(def.id);
      })
      .catch((err) => {
        if (!alive) return;
        setPipelinesError(
          err instanceof ApiError
            ? { status: err.status, message: err.message }
            : { status: 0, message: err instanceof Error ? err.message : 'Erro' },
        );
      })
      .finally(() => alive && setPipelinesLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedPipeline = useMemo(
    () => pipelines.find((p) => p.id === selectedId) ?? null,
    [pipelines, selectedId],
  );

  // ── Filtros do board ──
  const [filters, setFilters] = useState<BoardFilters>({});

  // ── Board ──
  const {
    board,
    loading: boardLoading,
    error: boardError,
    moveDealLocal,
    reorderInStageLocal,
    refetch,
  } = useBoard(selectedId, filters);

  // ── DnD state ──
  const [activeDealId, setActiveDealId] = useState<string | null>(null);
  const [pendingLostMove, setPendingLostMove] = useState<PendingMove | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const allDeals = useMemo(
    () => (board?.stages ?? []).flatMap((s) => s.deals),
    [board],
  );
  const activeDeal = useMemo(
    () => allDeals.find((d) => d.id === activeDealId) ?? null,
    [allDeals, activeDealId],
  );

  // ── Dialogs / sheet ──
  const [newDealOpen, setNewDealOpen] = useState(false);
  const [newDealStageId, setNewDealStageId] = useState<string | undefined>(undefined);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [selectedDealId, setSelectedDealId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // ── Atalho Ctrl+K / Cmd+K para abrir busca ──
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Carrega user atual pra filtrar próprias ações em toasts WS ──
  const currentUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    void supabase.auth.getUser().then(({ data }) => {
      currentUserIdRef.current = data.user?.id ?? null;
    });
  }, []);

  // ── Toasts em tempo real: outros agentes movendo / IA criando deals ──
  useEvents({
    onDealMoved: (payload) => {
      // Não toasta as próprias ações — só de outros agentes
      if (payload.moved_by_user_id === currentUserIdRef.current) return;
      const title = payload.deal_title ?? 'Negócio';
      const stage = payload.to_stage_name ?? 'outra etapa';
      if (payload.closed_state === 'won') {
        toast.success(`🏆 ${title} marcado como ganho!`);
      } else if (payload.closed_state === 'lost') {
        toast(`📉 ${title} marcado como perdido`);
      } else {
        toast(`Alguém moveu "${title}" → ${stage}`);
      }
      // Reload otimista — a row já mudou no DB
      void refetch();
    },
    onDealCreated: (payload) => {
      const tags = payload.deal.tags ?? [];
      const dealPipeline = pipelines.find((p) => p.id === payload.deal.pipeline_id);
      const inOtherPipeline =
        selectedId && payload.deal.pipeline_id !== selectedId && dealPipeline;

      if (tags.includes('ai-concierge')) {
        // Concierge criou — sempre destaca, indicando o funil
        if (inOtherPipeline) {
          toast.info(`🤖 IA criou lead em outro funil: ${payload.deal.title}`, {
            description: `Funil: ${dealPipeline.name}`,
            action: {
              label: 'Abrir funil',
              onClick: () => setSelectedId(payload.deal.pipeline_id),
            },
            duration: 8000,
          });
        } else {
          toast.info(`🤖 IA criou: ${payload.deal.title}`);
        }
        void refetch();
      } else if (tags.includes('lead-automatico')) {
        toast.info(`✨ Novo lead automático: ${payload.deal.title}`);
        void refetch();
      } else if (inOtherPipeline) {
        // Deal manual em outro funil também merece toast discreto
        toast.info(`Novo deal em "${dealPipeline.name}": ${payload.deal.title}`, {
          action: {
            label: 'Abrir funil',
            onClick: () => setSelectedId(payload.deal.pipeline_id),
          },
        });
      }
    },
  });

  function openCreate(stageId?: string) {
    setNewDealStageId(stageId);
    setNewDealOpen(true);
  }

  function openDeal(deal: BoardDealItem) {
    setSelectedDealId(deal.id);
    setDetailOpen(true);
  }

  // ── DnD handlers ──
  const handleDragStart = useCallback((e: DragStartEvent) => {
    setActiveDealId(String(e.active.id));
  }, []);

  const handleDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveDealId(null);
      const { active, over } = e;
      if (!over || !board) return;

      const activeId = String(active.id);
      const overId = String(over.id);

      // Localiza source stage do deal arrastado
      const sourceStage = findStageOfDeal(board.stages, activeId);
      if (!sourceStage) return;

      // Determina dest stage. overId pode ser:
      // - "column:<stageId>" → drop em coluna vazia
      // - <dealId> → drop em outro card (mesmo ou outro stage)
      let destStage: BoardStageGroup | null = null;
      let overDealIndex = -1;
      if (overId.startsWith('column:')) {
        const stageId = overId.slice('column:'.length);
        destStage = board.stages.find((s) => s.id === stageId) ?? null;
      } else {
        destStage = findStageOfDeal(board.stages, overId);
        if (destStage) {
          overDealIndex = destStage.deals.findIndex((d) => d.id === overId);
        }
      }
      if (!destStage) return;

      const sourceIdx = sourceStage.deals.findIndex((d) => d.id === activeId);
      if (sourceIdx < 0) return;

      // Mesmo stage → reorder
      if (sourceStage.id === destStage.id) {
        if (overDealIndex < 0 || overDealIndex === sourceIdx) return;
        // Snapshot pra revert se a API falhar
        const beforeIds = sourceStage.deals.map((d) => d.id);
        reorderInStageLocal(sourceStage.id, sourceIdx, overDealIndex);
        const newIds = arrayMove(beforeIds, sourceIdx, overDealIndex);
        try {
          await dealsApi.reorder({ stage_id: sourceStage.id, deal_ids: newIds });
        } catch (err) {
          // Revert ao estado anterior via refetch (sem otimismo)
          alertError('Falha ao reordenar — recarregando estado', err);
          await refetch();
        }
        return;
      }

      // Cross-stage → move
      const destIndex = overDealIndex >= 0 ? overDealIndex : destStage.deals.length;

      if (destStage.is_lost) {
        // Pendura — não aplica optimistic; abre dialog de motivo
        setPendingLostMove({
          dealId: activeId,
          fromStageId: sourceStage.id,
          toStageId: destStage.id,
          insertIndex: destIndex,
        });
        return;
      }

      // Optimistic move
      moveDealLocal(activeId, sourceStage.id, destStage.id, destIndex);
      try {
        await dealsApi.move(activeId, { stage_id: destStage.id, position: destIndex });
      } catch (err) {
        alertError('Falha ao mover deal — recarregando estado', err);
        await refetch();
      }
    },
    [board, moveDealLocal, reorderInStageLocal, refetch],
  );

  // ── Confirma "Perdido" com motivo ──
  async function confirmLost(reason: string) {
    if (!pendingLostMove) return;
    const { dealId, fromStageId, toStageId, insertIndex } = pendingLostMove;
    moveDealLocal(dealId, fromStageId, toStageId, insertIndex);
    setPendingLostMove(null);
    try {
      await dealsApi.move(dealId, {
        stage_id: toStageId,
        position: insertIndex,
        lost_reason: reason,
      });
    } catch (err) {
      alertError('Falha ao mover pra Perdido — recarregando', err);
      await refetch();
    }
  }

  function cancelLost() {
    setPendingLostMove(null);
  }

  // Drag-to-pan: clicar no fundo do board e arrastar move o scroll
  // horizontal. Threshold=8px > activation distance do dnd-kit (6px),
  // evitando conflito ao começar drag em cima de um card.
  const panRef = useDragToPan<HTMLDivElement>();

  // ── Render ──
  return (
    <div className="flex h-full flex-col">
      {(pipelinesError || boardError) && (
        <div className="flex items-center gap-2 border-b border-destructive/30 bg-destructive/10 px-6 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5" />
          <span>
            {pipelinesError?.status === 401 || boardError?.status === 401
              ? 'Sessão expirada — faça login pra carregar o funil.'
              : `Erro: ${(pipelinesError ?? boardError)?.message}`}
          </span>
        </div>
      )}

      <BoardHeader
        pipelines={pipelines}
        selectedPipelineId={selectedId}
        onSelectPipeline={setSelectedId}
        summary={board?.summary ?? null}
        loading={boardLoading || pipelinesLoading}
        onRefresh={() => void refetch()}
        onCreateDeal={() => openCreate()}
        onAnalyze={() => setAnalyzeOpen(true)}
      />

      {selectedId && pipelines.length > 0 && (
        <BoardFiltersBar
          filters={filters}
          onChange={setFilters}
          onOpenSearch={() => setSearchOpen(true)}
        />
      )}

      {/* Estados */}
      {pipelinesLoading ? (
        <BoardSkeleton />
      ) : pipelines.length === 0 ? (
        <EmptyPipelines />
      ) : !board ? (
        <BoardSkeleton />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
        >
          <div
            ref={panRef}
            className="flex-1 cursor-grab select-none overflow-x-auto overflow-y-hidden [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex h-full gap-3 px-6 py-4">
              {board.stages.map((stage) => (
                <BoardColumn
                  key={stage.id}
                  stage={stage}
                  pipelineId={selectedId!}
                  onSelectDeal={openDeal}
                  onChanged={() => void refetch()}
                />
              ))}
            </div>
          </div>

          <DragOverlay dropAnimation={{ duration: 200, easing: 'cubic-bezier(0.18, 0.67, 0.6, 1.22)' }}>
            {activeDeal ? <DealCardVisual deal={activeDeal} isOverlay /> : null}
          </DragOverlay>
        </DndContext>
      )}

      {/* Dialogs */}
      <NewDealDialog
        open={newDealOpen}
        onOpenChange={setNewDealOpen}
        pipeline={selectedPipeline}
        defaultStageId={newDealStageId}
        onCreated={() => {
          void refetch();
        }}
      />

      <FunnelAnalysisDialog
        open={analyzeOpen}
        onOpenChange={setAnalyzeOpen}
        pipelineId={selectedId}
      />

      <LostReasonDialog
        open={pendingLostMove !== null}
        onConfirm={confirmLost}
        onCancel={cancelLost}
      />

      <DealDetailSheet
        dealId={selectedDealId}
        pipeline={selectedPipeline}
        open={detailOpen}
        onOpenChange={(o) => {
          setDetailOpen(o);
          if (!o) setSelectedDealId(null);
        }}
        onChanged={() => void refetch()}
      />

      <BoardSearchPalette
        open={searchOpen}
        onOpenChange={setSearchOpen}
        deals={allDeals}
        onSelect={(dealId) => {
          const d = allDeals.find((x) => x.id === dealId);
          if (d) openDeal(d);
        }}
      />
    </div>
  );
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function findStageOfDeal(stages: BoardStageGroup[], dealId: string): BoardStageGroup | null {
  return stages.find((s) => s.deals.some((d) => d.id === dealId)) ?? null;
}

function arrayMove<T>(arr: T[], from: number, to: number): T[] {
  const next = [...arr];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

function alertError(prefix: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  // eslint-disable-next-line no-console
  console.error(`${prefix}: ${message}`);
}

function BoardSkeleton() {
  return (
    <div className="flex flex-1 gap-3 overflow-hidden px-6 py-4">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex w-[300px] shrink-0 flex-col gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ))}
    </div>
  );
}

function EmptyPipelines() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-12 text-center">
      <Inbox className="h-10 w-10 text-muted-foreground" />
      <div>
        <p className="text-base font-medium">Nenhum pipeline ainda</p>
        <p className="text-xs text-muted-foreground">
          Crie um pipeline rodando <code className="text-xs">setup_new_organization()</code> no
          Supabase ou via API.
        </p>
      </div>
      <Button asChild variant="outline">
        <a
          href="https://github.com/vazzocomercio-wq/eclick-active/blob/main/supabase/migrations/001_foundation_schema.sql"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver função SQL
        </a>
      </Button>
    </div>
  );
}
