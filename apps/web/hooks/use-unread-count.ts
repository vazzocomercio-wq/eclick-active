'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { conversationsApi } from '@/lib/api/conversations';
import { useEvents } from './use-events';

/**
 * Conta conversas com `unread_count > 0` (não-archived). Usado pelo sidebar
 * pra mostrar quantas conversas precisam de atenção. Refetch automático
 * quando chegam eventos `message:new` ou `conversation:updated` via Socket.IO.
 *
 * Padrão de fetch:
 *  - Inicial ao montar
 *  - Em eventos de socket, debounce 500ms (evita refetch em burst de mensagens)
 */
export function useUnreadCount(): number {
  const [count, setCount] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef(false);

  const fetchCount = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      // Pega 100 conversas mais recentes (não-archived) e conta as com unread > 0.
      // Não há endpoint dedicado de "count" — esse é simples e suficiente.
      const result = await conversationsApi.getInbox({ limit: 100 });
      const unread = result.data.filter(
        (c) => (c.unread_count ?? 0) > 0,
      ).length;
      setCount(unread);
    } catch {
      // silencia — sidebar simplesmente não atualiza
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    void fetchCount();
  }, [fetchCount]);

  // Debounced refetch on socket events
  const triggerRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void fetchCount();
    }, 500);
  }, [fetchCount]);

  // useMemo pra estabilizar a referência (useEvents depende de identity)
  const handlers = useMemo(
    () => ({
      onMessageNew: () => triggerRefetch(),
      onMessageUpdated: () => triggerRefetch(),
    }),
    [triggerRefetch],
  );
  useEvents(handlers);

  // Cleanup pendente
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return count;
}
