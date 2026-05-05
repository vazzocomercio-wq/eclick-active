'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Message } from '@eclick-active/shared';
import { messagesApi } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/client';
import { useEvents } from './use-events';

interface UseChatResult {
  messages: Message[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: { status: number; message: string } | null;
  loadMore: () => Promise<void>;
  send: (text: string, isInternalNote?: boolean) => Promise<void>;
  sending: boolean;
}

const PAGE_LIMIT = 50;

/**
 * Carrega mensagens de uma conversa com cursor pagination + atualização em
 * tempo real via Socket.IO (`message:new`, `message:updated`) — escutado pelo
 * EventsGateway do api. Não usamos Supabase Realtime aqui porque
 * `active.messages` é particionada e a delivery dos eventos das partições
 * filhas não chega ao cliente mesmo com `publish_via_partition_root=true`.
 *
 * `messages` armazenadas em ordem CRESCENTE (oldest → newest) — UI renderiza
 * top-down. Backend retorna DESC; revertemos antes de gravar no estado.
 */
export function useChat(conversationId: string | null): UseChatResult {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<UseChatResult['error']>(null);
  const [sending, setSending] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);

  // Initial load on conversation change
  useEffect(() => {
    if (!conversationId) {
      setMessages([]);
      setHasMore(false);
      cursorRef.current = null;
      return;
    }
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
    setMessages([]);

    messagesApi
      .getByConversation(conversationId, undefined, PAGE_LIMIT)
      .then((r) => {
        if (reqId !== reqIdRef.current) return;
        // Backend retorna newest first; reverse pra ter oldest → newest
        setMessages([...r.data].reverse());
        cursorRef.current = r.nextCursor;
        setHasMore(!!r.nextCursor);
      })
      .catch((err) => {
        if (reqId !== reqIdRef.current) return;
        if (err instanceof ApiError) {
          setError({ status: err.status, message: err.message });
        } else {
          setError({ status: 0, message: err instanceof Error ? err.message : 'Erro' });
        }
      })
      .finally(() => {
        if (reqId === reqIdRef.current) setLoading(false);
      });
  }, [conversationId]);

  // Realtime via socket.io — filtra pelo conversationId atual
  const realtimeHandlers = useMemo(
    () => ({
      onMessageNew: (payload: { conversation_id: string; message: Message }) => {
        if (payload.conversation_id !== conversationId) return;
        setMessages((prev) => {
          if (prev.some((m) => m.id === payload.message.id)) return prev;
          return [...prev, payload.message];
        });
      },
      onMessageUpdated: (payload: { conversation_id: string; message: Message }) => {
        if (payload.conversation_id !== conversationId) return;
        setMessages((prev) =>
          prev.map((m) => (m.id === payload.message.id ? payload.message : m)),
        );
      },
    }),
    [conversationId],
  );
  useEvents(realtimeHandlers);

  /**
   * Defesa em profundidade pra realtime. O socket.io reconecta sozinho
   * mas eventos perdidos durante o drop (ex: msg chegou no DB mas o WS
   * estava down) ficam invisíveis no chat. Refresh silencioso quando:
   *   1. User volta pra aba (visibilitychange)
   *   2. Janela ganha foco (focus)
   * Cobertura: 10min sem msgs → tab perde foco → user volta → atualiza.
   */
  useEffect(() => {
    if (!conversationId) return;

    const refetchSilently = () => {
      if (document.visibilityState !== 'visible') return;
      const reqId = ++reqIdRef.current;
      messagesApi
        .getByConversation(conversationId, undefined, PAGE_LIMIT)
        .then((r) => {
          if (reqId !== reqIdRef.current) return;
          setMessages([...r.data].reverse());
          cursorRef.current = r.nextCursor;
          setHasMore(!!r.nextCursor);
        })
        .catch(() => {
          /* silent — não polui UX se cair offline */
        });
    };

    document.addEventListener('visibilitychange', refetchSilently);
    window.addEventListener('focus', refetchSilently);
    return () => {
      document.removeEventListener('visibilitychange', refetchSilently);
      window.removeEventListener('focus', refetchSilently);
    };
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (!conversationId || !hasMore || loadingMore || !cursorRef.current) return;
    setLoadingMore(true);
    try {
      const r = await messagesApi.getByConversation(
        conversationId,
        cursorRef.current,
        PAGE_LIMIT,
      );
      // Página de mensagens mais antigas — também vem newest first do backend.
      setMessages((prev) => [...[...r.data].reverse(), ...prev]);
      cursorRef.current = r.nextCursor;
      setHasMore(!!r.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore]);

  const send = useCallback(
    async (text: string, isInternalNote = false) => {
      if (!conversationId) return;
      setSending(true);
      try {
        const persisted = await messagesApi.sendText(conversationId, text, isInternalNote);
        setMessages((prev) => {
          if (prev.some((m) => m.id === persisted.id)) return prev;
          return [...prev, persisted];
        });
      } finally {
        setSending(false);
      }
    },
    [conversationId],
  );

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    send,
    sending,
  };
}
