'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BoardResponse,
  BoardDealItem,
  pipelinesApi,
} from '@/lib/api/pipelines';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

interface UseBoardResult {
  board: BoardResponse | null;
  loading: boolean;
  error: { status: number; message: string } | null;
  /** Move local — pra optimistic update durante drag-and-drop. Não persiste. */
  moveDealLocal: (
    dealId: string,
    fromStageId: string,
    toStageId: string,
    insertIndex: number,
  ) => void;
  /** Reordena localmente dentro de um stage. Não persiste. */
  reorderInStageLocal: (stageId: string, fromIndex: number, toIndex: number) => void;
  /** Refetch completo — usado pra reverter um optimistic falho. */
  refetch: () => Promise<void>;
}

const REFRESH_DEBOUNCE_MS = 200;

/**
 * Carrega o board de um pipeline e mantém estado local sincronizado via
 * Supabase Realtime (active.deals INSERT/UPDATE/DELETE filtrado por
 * pipeline_id). Também expõe operações otimistas pro drag-and-drop.
 *
 * Estratégia de Realtime: qualquer mudança em deals do pipeline → refetch
 * com debounce 200ms. Mais simples que diff manual; o board é uma única
 * chamada barata.
 */
export function useBoard(pipelineId: string | null): UseBoardResult {
  const [board, setBoard] = useState<BoardResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<UseBoardResult['error']>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(async () => {
    if (!pipelineId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await pipelinesApi.getBoard(pipelineId);
      setBoard(data);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ status: err.status, message: err.message });
      } else {
        setError({
          status: 0,
          message: err instanceof Error ? err.message : 'Erro',
        });
      }
    } finally {
      setLoading(false);
    }
  }, [pipelineId]);

  // Initial load + on pipeline change
  useEffect(() => {
    if (!pipelineId) {
      setBoard(null);
      return;
    }
    void refetch();
  }, [pipelineId, refetch]);

  // Realtime: mudanças em deals → refetch debounced
  useEffect(() => {
    if (!pipelineId) return;
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return; // sem env, sem realtime
    }

    const scheduleRefetch = () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = setTimeout(() => {
        void refetch();
      }, REFRESH_DEBOUNCE_MS);
    };

    const channel = supabase
      .channel(`board:${pipelineId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: '*',
          schema: 'active',
          table: 'deals',
          filter: `pipeline_id=eq.${pipelineId}`,
        },
        scheduleRefetch,
      )
      .subscribe();

    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      void channel.unsubscribe();
    };
  }, [pipelineId, refetch]);

  // ──────────────────────────────────────────────────────────
  // Optimistic helpers
  // ──────────────────────────────────────────────────────────

  const recomputeStageStats = useCallback(
    (stage: BoardResponse['stages'][number]): BoardResponse['stages'][number] => {
      const total = stage.deals.reduce((sum, d) => sum + Number(d.value || 0), 0);
      return {
        ...stage,
        deals_count: stage.deals.length,
        total_value: Math.round(total * 100) / 100,
      };
    },
    [],
  );

  const moveDealLocal = useCallback(
    (dealId: string, fromStageId: string, toStageId: string, insertIndex: number) => {
      setBoard((b) => {
        if (!b) return b;
        const stages = b.stages.map((s) => ({ ...s, deals: [...s.deals] }));
        const fromStage = stages.find((s) => s.id === fromStageId);
        const toStage = stages.find((s) => s.id === toStageId);
        if (!fromStage || !toStage) return b;
        const dealIdx = fromStage.deals.findIndex((d) => d.id === dealId);
        if (dealIdx < 0) return b;
        const [deal] = fromStage.deals.splice(dealIdx, 1);
        if (!deal) return b;
        // Reflete novo stage no card pra UI consistente
        const movedDeal: BoardDealItem = {
          ...deal,
          stage_id: toStage.id,
          stage_name: toStage.name,
          stage_color: toStage.color,
          stage_probability: toStage.probability,
          sla_hours: toStage.sla_hours,
        };
        const safeIdx = Math.max(0, Math.min(insertIndex, toStage.deals.length));
        toStage.deals.splice(safeIdx, 0, movedDeal);
        // Recomputa stats
        const next = stages.map((s) =>
          s.id === fromStage.id || s.id === toStage.id ? recomputeStageStats(s) : s,
        );
        return { ...b, stages: next };
      });
    },
    [recomputeStageStats],
  );

  const reorderInStageLocal = useCallback(
    (stageId: string, fromIndex: number, toIndex: number) => {
      setBoard((b) => {
        if (!b) return b;
        const stages = b.stages.map((s) => ({ ...s, deals: [...s.deals] }));
        const stage = stages.find((s) => s.id === stageId);
        if (!stage) return b;
        if (fromIndex < 0 || toIndex < 0) return b;
        if (fromIndex >= stage.deals.length) return b;
        const [deal] = stage.deals.splice(fromIndex, 1);
        if (!deal) return b;
        const safeIdx = Math.max(0, Math.min(toIndex, stage.deals.length));
        stage.deals.splice(safeIdx, 0, deal);
        return { ...b, stages };
      });
    },
    [],
  );

  return {
    board,
    loading,
    error,
    moveDealLocal,
    reorderInStageLocal,
    refetch,
  };
}
