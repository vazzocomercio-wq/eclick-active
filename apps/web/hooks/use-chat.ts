'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message } from '@eclick-active/shared';
import { messagesApi } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

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
 * Carrega mensagens de uma conversa com cursor pagination + Supabase Realtime
 * pra novos INSERTs em active.messages.
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

  // Realtime: novos INSERTs filtrados pela conversa atual
  useEffect(() => {
    if (!conversationId) return;
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return;
    }

    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: 'INSERT',
          schema: 'active',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: Message }) => {
          setMessages((prev) => {
            // Evita duplicar se a mensagem já foi adicionada via send() local
            if (prev.some((m) => m.id === payload.new.id)) return prev;
            return [...prev, payload.new];
          });
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        {
          event: 'UPDATE',
          schema: 'active',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: Message }) => {
          setMessages((prev) =>
            prev.map((m) => (m.id === payload.new.id ? payload.new : m)),
          );
        },
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
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
