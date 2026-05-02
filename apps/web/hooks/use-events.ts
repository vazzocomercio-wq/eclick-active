'use client';

import { useEffect } from 'react';
import type { Deal } from '@eclick-active/shared';
import { getSocket } from '@/lib/realtime/socket-client';

interface AISuggestionPayload {
  conversation_id: string;
  suggestion: string;
  confidence?: number;
  /** ID da row em ai_interactions — pra UI permitir 👍/👎. */
  ai_interaction_id?: string;
}

interface DealMovedPayload {
  deal_id: string;
  from_stage_id: string;
  to_stage_id: string;
  position: number;
  closed_state?: 'won' | 'lost' | null;
  /** Quem moveu — frontend usa pra evitar toastar próprias ações. */
  moved_by_user_id?: string;
  deal_title?: string;
  to_stage_name?: string;
}

interface DealCreatedPayload {
  deal: Deal;
}

interface DealUpdatedPayload {
  deal: Deal;
}

interface UseEventsHandlers {
  onAISuggestion?: (payload: AISuggestionPayload) => void;
  onDealMoved?: (payload: DealMovedPayload) => void;
  onDealCreated?: (payload: DealCreatedPayload) => void;
  onDealUpdated?: (payload: DealUpdatedPayload) => void;
}

/**
 * Conecta no namespace `/events` do api e registra handlers para eventos
 * custom do CRM. Mudanças puras de row em conversations/messages chegam
 * via Supabase Realtime — esse hook só cuida de eventos custom (ai:*,
 * deal:*, etc.).
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
      const onMoved = (payload: DealMovedPayload) => {
        handlers.onDealMoved?.(payload);
      };
      const onCreated = (payload: DealCreatedPayload) => {
        handlers.onDealCreated?.(payload);
      };
      const onUpdated = (payload: DealUpdatedPayload) => {
        handlers.onDealUpdated?.(payload);
      };

      socket.on('ai:suggestion', onAI);
      socket.on('deal:moved', onMoved);
      socket.on('deal:created', onCreated);
      socket.on('deal:updated', onUpdated);

      cleanup = () => {
        socket.off('ai:suggestion', onAI);
        socket.off('deal:moved', onMoved);
        socket.off('deal:created', onCreated);
        socket.off('deal:updated', onUpdated);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [handlers]);
}
