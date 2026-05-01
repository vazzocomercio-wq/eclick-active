'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { dashboardApi, type DashboardSummary } from '@/lib/api/dashboard';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

interface UseDashboardResult {
  data: DashboardSummary | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

const ACTIVE_SCHEMA = 'active';

/**
 * Carrega `/dashboard/summary` e refaz o fetch (debounced 500ms) sempre que
 * deals/conversations/tasks/messages mudam via Realtime.
 *
 * Não tenta ser mais esperto que isso — uma chamada agregada por evento é o
 * suficiente, e evita drift entre os 5 blocos.
 */
export function useDashboard(): UseDashboardResult {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnce = useCallback(async (signal?: AbortSignal): Promise<void> => {
    setError(null);
    try {
      const summary = await dashboardApi.getSummary(signal);
      setData(summary);
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      const msg =
        err instanceof ApiError
          ? `${err.status}: ${err.message}`
          : err instanceof Error
            ? err.message
            : 'Erro ao carregar dashboard';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  const refetch = useCallback(async () => {
    setLoading(true);
    await fetchOnce();
  }, [fetchOnce]);

  // Initial load
  useEffect(() => {
    const ctrl = new AbortController();
    fetchOnce(ctrl.signal);
    return () => ctrl.abort();
  }, [fetchOnce]);

  // Realtime — dispara um refetch debounced em qualquer mudança em
  // deals/conversations/tasks/messages do org. Filtros server-side por org
  // virariam ruído (sem ON CONFLICT info no client) — preferimos refetch
  // simples e deixar o backend fazer o agregado correto.
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
      }, 500);
    };

    const channel = supabase
      .channel('dashboard-summary')
      .on(
        'postgres_changes',
        { event: '*', schema: ACTIVE_SCHEMA, table: 'deals' },
        triggerRefetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: ACTIVE_SCHEMA, table: 'conversations' },
        triggerRefetch,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: ACTIVE_SCHEMA, table: 'tasks' },
        triggerRefetch,
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: ACTIVE_SCHEMA, table: 'messages' },
        triggerRefetch,
      )
      .subscribe();

    return () => {
      if (refetchTimerRef.current) clearTimeout(refetchTimerRef.current);
      supabase.removeChannel(channel);
    };
  }, [fetchOnce]);

  return { data, loading, error, refetch };
}
