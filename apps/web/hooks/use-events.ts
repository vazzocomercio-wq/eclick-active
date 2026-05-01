'use client';

import { useEffect } from 'react';
import { getSocket } from '@/lib/realtime/socket-client';

interface AISuggestionPayload {
  conversation_id: string;
  suggestion: string;
  confidence?: number;
}

interface UseEventsHandlers {
  onAISuggestion?: (payload: AISuggestionPayload) => void;
}

/**
 * Conecta no namespace `/events` do api e registra handlers para eventos
 * custom do CRM. Mudanças puras de row em conversations/messages chegam
 * via Supabase Realtime — esse hook só cuida de eventos custom (ai:*, etc.).
 */
export function useEvents(handlers: UseEventsHandlers): void {
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const onAI = (payload: AISuggestionPayload) => {
        handlers.onAISuggestion?.(payload);
      };

      socket.on('ai:suggestion', onAI);
      cleanup = () => {
        socket.off('ai:suggestion', onAI);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [handlers]);
}
