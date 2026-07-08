'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Json, Message, MessageDeliveryStatus } from '@eclick-active/shared';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
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
  /** Reenvia uma mensagem optimistic que falhou (status 'failed'). */
  retry: (messageId: string) => Promise<void>;
  sending: boolean;
}

const PAGE_LIMIT = 50;

function readBody(m: Message): string {
  const body = (m.content as Record<string, unknown> | null)?.body;
  if (typeof body === 'string') return body;
  return m.plain_text ?? '';
}

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
  const t = useTranslations('inbox.messageInput');
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<UseChatResult['error']>(null);
  const [sending, setSending] = useState(false);

  const cursorRef = useRef<string | null>(null);
  const reqIdRef = useRef(0);
  // Guarda a conversa atual — usado por send/loadMore/refetch pra descartar
  // um setMessages tardio quando o usuário já trocou de conversa (evita que
  // resposta de conversa antiga vaze pra thread nova).
  const conversationIdRef = useRef(conversationId);
  // Snapshot das mensagens pra retry ler o corpo sem virar dependência.
  const messagesRef = useRef<Message[]>([]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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
          // Se essa mensagem é o eco de uma bolha optimistic nossa (outbound
          // com mesmo corpo ainda pendente), substitui em vez de duplicar.
          if (payload.message.direction === 'outbound') {
            const optimisticIdx = prev.findIndex(
              (m) =>
                m.id.startsWith('temp-') &&
                m.direction === 'outbound' &&
                m.status !== 'failed' &&
                readBody(m) === readBody(payload.message),
            );
            if (optimisticIdx !== -1) {
              const next = [...prev];
              next[optimisticIdx] = payload.message;
              return next;
            }
          }
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
   *
   * MESCLA só as mensagens novas — NÃO descarta páginas já carregadas via
   * loadMore (senão o refetch trunca o histórico paginado pros últimos 50).
   * Os dois listeners (focus + visibilitychange) disparam quase juntos ao
   * voltar pra aba; um throttle curto deduplica pra não fazer 2 fetches.
   */
  useEffect(() => {
    if (!conversationId) return;
    const cid = conversationId;
    let lastRun = 0;

    const refetchSilently = () => {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastRun < 1000) return; // dedupe focus + visibilitychange
      lastRun = now;

      messagesApi
        .getByConversation(cid, undefined, PAGE_LIMIT)
        .then((r) => {
          if (conversationIdRef.current !== cid) return;
          const incoming = [...r.data].reverse();
          setMessages((prev) => {
            const seen = new Set(prev.map((m) => m.id));
            const additions = incoming.filter((m) => !seen.has(m.id));
            if (additions.length === 0) return prev;
            const merged = [...prev, ...additions];
            merged.sort((a, b) => a.created_at.localeCompare(b.created_at));
            return merged;
          });
          // NÃO mexe em cursorRef/hasMore — preserva a paginação já carregada.
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
    const cid = conversationId;
    setLoadingMore(true);
    try {
      const r = await messagesApi.getByConversation(cid, cursorRef.current, PAGE_LIMIT);
      if (conversationIdRef.current !== cid) return;
      // Página de mensagens mais antigas — também vem newest first do backend.
      setMessages((prev) => [...[...r.data].reverse(), ...prev]);
      cursorRef.current = r.nextCursor;
      setHasMore(!!r.nextCursor);
    } catch {
      // Swallow — o sentinel do IntersectionObserver tenta de novo quando
      // voltar à viewport. Evita unhandled rejection.
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, hasMore, loadingMore]);

  const send = useCallback(
    async (text: string, isInternalNote = false) => {
      if (!conversationId) return;
      const cid = conversationId;
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // Bolha optimistic — aparece imediatamente com status 'pending'.
      const optimistic: Message = {
        id: tempId,
        conversation_id: cid,
        org_id: '',
        direction: 'outbound',
        sender_type: 'agent',
        sender_id: null,
        content_type: 'text',
        content: { body: text } as unknown as Json,
        plain_text: text,
        media_url: null,
        media_mime_type: null,
        media_size_bytes: null,
        channel_message_id: null,
        status: 'pending',
        error_code: null,
        error_message: null,
        ai_intent: null,
        ai_sentiment: null,
        metadata: {} as Json,
        is_internal_note: isInternalNote,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      try {
        const persisted = await messagesApi.sendText(cid, text, isInternalNote);
        if (conversationIdRef.current !== cid) return;
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === persisted.id)) return withoutTemp;
          return [...withoutTemp, persisted];
        });
      } catch (err) {
        if (conversationIdRef.current !== cid) return;
        // Marca a bolha como falha — MessageBubble mostra ícone + botão
        // reenviar. O texto NÃO some (fica retido na bolha retryável).
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, status: 'failed' as MessageDeliveryStatus } : m,
          ),
        );
        toast.error(t('sendFailed'), {
          description: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setSending(false);
      }
    },
    [conversationId, t],
  );

  const retry = useCallback(
    async (messageId: string) => {
      const cid = conversationIdRef.current;
      if (!cid) return;
      const msg = messagesRef.current.find((m) => m.id === messageId);
      if (!msg) return;
      const text = readBody(msg);
      if (!text) return;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, status: 'pending' as MessageDeliveryStatus } : m,
        ),
      );
      setSending(true);
      try {
        const persisted = await messagesApi.sendText(cid, text, msg.is_internal_note);
        if (conversationIdRef.current !== cid) return;
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== messageId);
          if (without.some((m) => m.id === persisted.id)) return without;
          return [...without, persisted];
        });
      } catch (err) {
        if (conversationIdRef.current !== cid) return;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, status: 'failed' as MessageDeliveryStatus } : m,
          ),
        );
        toast.error(t('sendFailed'), {
          description: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setSending(false);
      }
    },
    [t],
  );

  return {
    messages,
    loading,
    loadingMore,
    hasMore,
    error,
    loadMore,
    send,
    retry,
    sending,
  };
}
