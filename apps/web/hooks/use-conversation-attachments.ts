'use client';

import { useEffect, useRef, useState } from 'react';
import {
  attachmentsApi,
  type ConversationAttachment,
} from '@/lib/api/attachments';

interface PendingMediaMessage {
  /** ID da msg que esperamos ter attachment */
  message_id: string;
  /** Ms desde Date.now() em que detectamos pela 1ª vez */
  detected_at: number;
}

const POLL_INTERVAL_MS = 2500;
const POLL_MAX_DURATION_MS = 60_000; // 1min — depois disso desiste

/**
 * Carrega attachments de uma conversa e expõe Map<messageId, attachment[]>.
 *
 * Refetch happens em 3 casos:
 *   1. conversationId muda → primeira load
 *   2. refreshKey muda (any string/number) → trigger explícito do caller
 *   3. AUTO-POLL: quando há msgs de mídia recentes (`pendingMediaMessageIds`)
 *      sem attachment associado, refaz fetch a cada 2.5s até aparecerem
 *      OU até passar 1min (worker pode ter falhado o download da mídia).
 *
 * Esse poll resolve o bug "documento aparece como indisponível e só aparece
 * após F5" — quando inbound de mídia chega via socket, attachment leva ~1-3s
 * pra ser criado pelo worker (download + upload Storage); UI agora aguarda.
 */
export function useConversationAttachments(
  conversationId: string | null,
  refreshKey: string | number = 0,
  pendingMediaMessageIds: string[] = [],
): Map<string, ConversationAttachment[]> {
  const [byMessage, setByMessage] = useState<Map<string, ConversationAttachment[]>>(
    new Map(),
  );

  // Tracking de msgs aguardando attachment — começa quando vê msg nova,
  // para quando attachment chega ou expira após POLL_MAX_DURATION_MS
  const pendingRef = useRef<Map<string, PendingMediaMessage>>(new Map());
  const reqIdRef = useRef(0);

  // Sincroniza pendingRef com a prop externa
  useEffect(() => {
    const now = Date.now();
    for (const id of pendingMediaMessageIds) {
      if (!pendingRef.current.has(id)) {
        pendingRef.current.set(id, { message_id: id, detected_at: now });
      }
    }
    // Limpa entries que expiraram
    for (const [id, entry] of pendingRef.current) {
      if (now - entry.detected_at > POLL_MAX_DURATION_MS) {
        pendingRef.current.delete(id);
      }
    }
  }, [pendingMediaMessageIds]);

  useEffect(() => {
    if (!conversationId) {
      setByMessage(new Map());
      pendingRef.current.clear();
      return;
    }
    const ctrl = new AbortController();
    const reqId = ++reqIdRef.current;

    const fetchOnce = async (): Promise<void> => {
      try {
        const rows = await attachmentsApi.forConversation(conversationId, ctrl.signal);
        if (reqId !== reqIdRef.current) return; // outra conv carregada já
        const m = new Map<string, ConversationAttachment[]>();
        for (const r of rows) {
          const list = m.get(r.message_id) ?? [];
          list.push(r);
          m.set(r.message_id, list);
          // Se o attachment chegou, remove da fila de pending
          pendingRef.current.delete(r.message_id);
        }
        setByMessage(m);
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return;
        // silently fail
      }
    };

    void fetchOnce();

    // Auto-poll enquanto houver msgs de mídia esperando attachment
    const interval = setInterval(() => {
      const now = Date.now();
      // Limpa entries expiradas
      for (const [id, entry] of pendingRef.current) {
        if (now - entry.detected_at > POLL_MAX_DURATION_MS) {
          pendingRef.current.delete(id);
        }
      }
      if (pendingRef.current.size === 0) return; // nada pendente — economiza HTTP
      void fetchOnce();
    }, POLL_INTERVAL_MS);

    return () => {
      ctrl.abort();
      clearInterval(interval);
    };
  }, [conversationId, refreshKey]);

  return byMessage;
}
