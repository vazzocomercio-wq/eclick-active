'use client';

import { useEffect } from 'react';
import type { Deal, Message } from '@eclick-active/shared';
import { getSocket } from '@/lib/realtime/socket-client';

interface AISuggestionPayload {
  conversation_id: string;
  suggestion: string;
  confidence?: number;
  /** ID da row em ai_interactions — pra UI permitir 👍/👎. */
  ai_interaction_id?: string;
  /** Fontes live consultadas em tempo real (Feature B). */
  live_sources_used?: Array<{ id: string; name: string; url: string }>;
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

interface MessageNewPayload {
  conversation_id: string;
  message: Message;
}

interface MessageUpdatedPayload {
  conversation_id: string;
  message: Message;
}

interface UseEventsHandlers {
  onAISuggestion?: (payload: AISuggestionPayload) => void;
  onDealMoved?: (payload: DealMovedPayload) => void;
  onDealCreated?: (payload: DealCreatedPayload) => void;
  onDealUpdated?: (payload: DealUpdatedPayload) => void;
  onMessageNew?: (payload: MessageNewPayload) => void;
  onMessageUpdated?: (payload: MessageUpdatedPayload) => void;
}

/**
 * Conecta no namespace `/events` do api e registra handlers para eventos
 * custom do CRM. Atualizações de mensagens (criação + status) também passam
 * por aqui — o Supabase Realtime para `active.messages` é particionado e
 * tem entrega instável, então usamos socket.io como canal único.
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
      const onMsgNew = (payload: MessageNewPayload) => {
        handlers.onMessageNew?.(payload);
      };
      const onMsgUpdated = (payload: MessageUpdatedPayload) => {
        handlers.onMessageUpdated?.(payload);
      };

      socket.on('ai:suggestion', onAI);
      socket.on('deal:moved', onMoved);
      socket.on('deal:created', onCreated);
      socket.on('deal:updated', onUpdated);
      socket.on('message:new', onMsgNew);
      socket.on('message:updated', onMsgUpdated);

      cleanup = () => {
        socket.off('ai:suggestion', onAI);
        socket.off('deal:moved', onMoved);
        socket.off('deal:created', onCreated);
        socket.off('deal:updated', onUpdated);
        socket.off('message:new', onMsgNew);
        socket.off('message:updated', onMsgUpdated);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [handlers]);
}
