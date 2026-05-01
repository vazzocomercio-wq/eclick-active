'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  tasksApi,
  type ListTasksParams,
  type PaginatedTasks,
  type TaskRow,
} from '@/lib/api/tasks';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

interface UseTasksResult {
  data: PaginatedTasks | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  /** Atualiza uma task localmente (otimista) */
  patchLocal: (id: string, patch: Partial<TaskRow>) => void;
  /** Remove uma task localmente (otimista) */
  removeLocal: (id: string) => void;
}

const ACTIVE_SCHEMA = 'active';

/**
 * Lista tarefas com filtros + Realtime debounced (200ms) em mudanças
 * de active.tasks.
 */
export function useTasks(params: ListTasksParams): UseTasksResult {
  const [data, setData] = useState<PaginatedTasks | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paramsKey = JSON.stringify(params);

  const fetchOnce = useCallback(async (signal?: AbortSignal) => {
    setError(null);
    try {
      const result = await tasksApi.list(params, signal);
      setData(result);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar tarefas';
      setError(msg);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey]);

  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchOnce();
  }, [fetchOnce]);

  // Initial / params-change load
  useEffect(() => {
    setLoading(true);
    const ctrl = new AbortController();
    fetchOnce(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchOnce]);

  // Realtime
  useEffect(() => {
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    const triggerRefetch = () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      refetchTimerRef.current = setTimeout(() => {
        fetchOnce();
      }, 200);
    };

    const channel = supabase
      .channel('tasks-list')
      .on(
        'postgres_changes',
        { event: '*', schema: ACTIVE_SCHEMA, table: 'tasks' },
        triggerRefetch,
      )
      .subscribe();

    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchOnce]);

  const patchLocal = useCallback((id: string, patch: Partial<TaskRow>) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        data: prev.data.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      };
    });
  }, []);

  const removeLocal = useCallback((id: string) => {
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        data: prev.data.filter((t) => t.id !== id),
        total: Math.max(0, prev.total - 1),
      };
    });
  }, []);

  return { data, loading, error, refetch, patchLocal, removeLocal };
}
