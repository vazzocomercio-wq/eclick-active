'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxItem, Conversation, Message } from '@eclick-active/shared';
import { conversationsApi, type InboxParams } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { getSocket } from '@/lib/realtime/socket-client';

export type InboxFilter =
  | 'all'
  | 'mine'
  | 'unassigned'
  | 'resolved'
  | 'archived'
  | 'starred';

interface UseInboxResult {
  /** Itens já filtrados por busca client-side + filtro 'unassigned'. */
  items: InboxItem[];
  /** Itens carregados sem o filtro de busca client-side (todas as páginas). */
  rawItems: InboxItem[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  loadMore: () => Promise<void>;
  error: { status: number; message: string } | null;
  filter: InboxFilter;
  setFilter: (f: InboxFilter) => void;
  search: string;
  setSearch: (q: string) => void;
  refetch: () => Promise<void>;
  /** Optimistic update: aplica patch local sem esperar socket/refetch. */
  patchLocal: (conversationId: string, patch: Partial<InboxItem>) => void;
  /** Remove imediatamente da lista (pra arquivar/resolver com feedback instantâneo). */
  removeLocal: (conversationId: string) => void;
  /** Informa qual conversa está aberta — evita subir unread dela. */
  setActiveConversationId: (id: string | null) => void;
}

const PAGE_LIMIT = 50;
/** Polling de backup — refetch silencioso enquanto a aba está visível.
 * Funciona como rede de segurança caso o socket caia ou eventos sejam perdidos. */
const POLL_INTERVAL_MS = 30_000;

export function useInbox(): UseInboxResult {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<UseInboxResult['error']>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');

  // Refs de request SEPARADOS pro fetch com loading e pro fetch silencioso —
  // se compartilhassem, um poll silencioso incrementaria o ref e o finally do
  // fetch com loading nunca chamaria setLoading(false) (loading travado).
  const loadReqRef = useRef(0);
  const silentReqRef = useRef(0);
  const pageRef = useRef(1);
  const itemsCountRef = useRef(0);
  const activeConvRef = useRef<string | null>(null);

  useEffect(() => {
    itemsCountRef.current = items.length;
  }, [items]);

  const buildParams = useCallback(
    (page: number, limit: number): InboxParams => ({
      page,
      limit,
      ...(filter === 'mine' ? { mine: true } : {}),
      ...(filter === 'resolved' ? { status: 'resolved' as const } : {}),
      ...(filter === 'archived' ? { status: 'archived' as const } : {}),
      ...(filter === 'starred' ? { starred: true } : {}),
    }),
    [filter],
  );

  /**
   * Fetch da primeira página. Pode ser silencioso (não muda loading) pra
   * polling de backup. O silencioso re-busca TODAS as páginas já carregadas
   * (limit = itens carregados) pra não truncar o histórico paginado.
   */
  const fetchInbox = useCallback(
    async (silent = false) => {
      if (silent) {
        const reqId = ++silentReqRef.current;
        const limit = Math.max(PAGE_LIMIT, itemsCountRef.current);
        try {
          const result = await conversationsApi.getInbox(buildParams(1, limit));
          if (reqId !== silentReqRef.current) return;
          setItems(result.data);
          pageRef.current = Math.max(1, Math.ceil(result.data.length / PAGE_LIMIT));
          setHasMore(result.total > result.data.length);
          setError(null);
        } catch {
          /* silent — não polui UX se cair offline */
        }
        return;
      }

      const reqId = ++loadReqRef.current;
      setLoading(true);
      setError(null);
      try {
        const result = await conversationsApi.getInbox(buildParams(1, PAGE_LIMIT));
        if (reqId !== loadReqRef.current) return;
        setItems(result.data);
        pageRef.current = 1;
        setHasMore(result.total > result.data.length);
      } catch (err) {
        if (reqId !== loadReqRef.current) return;
        if (err instanceof ApiError) {
          setError({ status: err.status, message: err.message });
        } else {
          setError({ status: 0, message: err instanceof Error ? err.message : 'Erro' });
        }
        setItems([]);
        setHasMore(false);
      } finally {
        if (reqId === loadReqRef.current) setLoading(false);
      }
    },
    [buildParams],
  );

  const refetch = useCallback(() => fetchInbox(false), [fetchInbox]);

  /** Carrega a próxima página e ANEXA (infinite scroll). */
  const loadMore = useCallback(async () => {
    if (loading || loadingMore || !hasMore) return;
    const reqId = loadReqRef.current; // aborta se o filtro trocar no meio
    const nextPage = pageRef.current + 1;
    setLoadingMore(true);
    try {
      const result = await conversationsApi.getInbox(buildParams(nextPage, PAGE_LIMIT));
      if (reqId !== loadReqRef.current) return;
      pageRef.current = nextPage;
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        const additions = result.data.filter((i) => !seen.has(i.id));
        return additions.length === 0 ? prev : [...prev, ...additions];
      });
      setHasMore(nextPage * PAGE_LIMIT < result.total);
    } catch {
      /* swallow — o sentinel tenta de novo ao reaparecer na viewport */
    } finally {
      setLoadingMore(false);
    }
  }, [buildParams, hasMore, loading, loadingMore]);

  /**
   * Optimistic update: aplica mudanças locais imediatamente sem esperar
   * round-trip da api. Usado quando o agente arquiva/resolve/atribui:
   * em vez de esperar o emit conversation:updated voltar pelo socket,
   * já remove/atualiza na hora pra UX ficar instantânea. Polling de
   * backup garante consistência em alguns segundos.
   */
  const patchLocal = useCallback(
    (conversationId: string, patch: Partial<InboxItem>) => {
      setItems((prev) => prev.map((it) => (it.id === conversationId ? { ...it, ...patch } : it)));
    },
    [],
  );

  const removeLocal = useCallback((conversationId: string) => {
    setItems((prev) => prev.filter((it) => it.id !== conversationId));
  }, []);

  const setActiveConversationId = useCallback((id: string | null) => {
    activeConvRef.current = id;
  }, []);

  // Fetch inicial + ao mudar filter
  useEffect(() => {
    void fetchInbox(false);
  }, [fetchInbox]);

  /**
   * Polling de backup (silencioso) + refetch ao voltar pra aba.
   *
   * Sem isso, se o socket cair (token expirado, rede ruim, server reboot),
   * o inbox congela até o user dar F5. Com polling de 30s + refetch on
   * focus/visibility, garantimos que mensagens novas e mudanças de status
   * apareçam mesmo que o realtime esteja "mudo".
   */
  useEffect(() => {
    if (typeof document === 'undefined') return;
    let timer: ReturnType<typeof setInterval> | null = null;

    function startPolling() {
      if (timer) return;
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') {
          void fetchInbox(true);
        }
      }, POLL_INTERVAL_MS);
    }

    function stopPolling() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') {
        // User voltou pra aba — força refetch imediato pra recuperar
        // qualquer evento perdido enquanto estava em background.
        void fetchInbox(true);
        startPolling();
      } else {
        stopPolling();
      }
    }

    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onVisibilityChange);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onVisibilityChange);
    };
  }, [fetchInbox]);

  // Realtime via Socket.IO (namespace /events da nossa api).
  //
  // ATENÇÃO: NÃO usamos Supabase Realtime aqui — o schema custom `active`
  // exige publication configurada no Postgres que não temos. A api emite
  // `message:new` e `conversation:updated` via socket.io quando webhook
  // entra ou worker insere. Esse hook escuta esses eventos e atualiza o
  // inbox local sem refresh.
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const onConvUpdated = (payload: { conversation: Conversation }) => {
        const updated = payload.conversation;
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.id === updated.id);
          // Conversa nova (criada via outbound start ou primeira inbound)
          // → trigger refetch pra puxar o InboxItem completo (com contact join)
          if (idx === -1) {
            void refetch();
            return prev;
          }

          // Item virou archived e o filtro ativo não é 'archived' — remove
          if (updated.status === 'archived' && filter !== 'archived') {
            return prev.filter((_, i) => i !== idx);
          }
          // Inverso: item deixou de ser archived e estamos em 'archived' — remove
          if (updated.status !== 'archived' && filter === 'archived') {
            return prev.filter((_, i) => i !== idx);
          }

          // Se a conversa está aberta na tela, mantém unread zerado.
          const isActive = updated.id === activeConvRef.current;
          const merged: InboxItem = {
            ...prev[idx]!,
            status: updated.status,
            priority: updated.priority,
            assigned_to: updated.assigned_to,
            unread_count: isActive ? 0 : updated.unread_count,
            ai_summary: updated.ai_summary,
            ai_sentiment: updated.ai_sentiment,
            ai_intent: updated.ai_intent,
            ai_temperature: updated.ai_temperature,
            ai_next_action: updated.ai_next_action,
            tags: updated.tags,
            last_message_at: updated.last_message_at,
            first_response_at: updated.first_response_at,
          };
          const next = [...prev];
          next[idx] = merged;
          // Re-sort por last_message_at desc
          return next.sort((a, b) =>
            (b.last_message_at ?? b.created_at).localeCompare(
              a.last_message_at ?? a.created_at,
            ),
          );
        });
      };

      const onMessageNew = (payload: {
        conversation_id: string;
        message: Message;
      }) => {
        // Atualização incremental — bumpa last_message_at, preview text
        // e re-sort. last_message_text/direction são campos da v_inbox
        // (preview da última msg) — atualizando aqui evita preview stale
        // até o próximo refetch.
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.id === payload.conversation_id);
          if (idx === -1) {
            // Conversa nova — refetch pra puxar o InboxItem
            void refetch();
            return prev;
          }
          // Conversa aberta na tela → não sobe unread (o agente está vendo).
          const isActive = payload.conversation_id === activeConvRef.current;
          const next = [...prev];
          next[idx] = {
            ...prev[idx]!,
            last_message_at:
              payload.message.created_at ??
              prev[idx]!.last_message_at ??
              new Date().toISOString(),
            last_message_text: payload.message.plain_text ?? null,
            last_message_direction: payload.message.direction,
            // Bump unread só se for inbound E a conversa NÃO estiver aberta.
            // Conversa aberta permanece com unread 0.
            unread_count: isActive
              ? 0
              : payload.message.direction === 'inbound'
                ? prev[idx]!.unread_count + 1
                : prev[idx]!.unread_count,
          };
          return next.sort((a, b) =>
            (b.last_message_at ?? b.created_at).localeCompare(
              a.last_message_at ?? a.created_at,
            ),
          );
        });
      };

      socket.on('conversation:updated', onConvUpdated);
      socket.on('message:new', onMessageNew);

      cleanup = () => {
        socket.off('conversation:updated', onConvUpdated);
        socket.off('message:new', onMessageNew);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [refetch, filter]);

  // Filtros que aplicamos client-side (backend não tem suporte direto)
  const filtered = items.filter((item) => {
    if (filter === 'unassigned' && item.assigned_to !== null) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [item.contact_name, item.contact_phone, item.contact_email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  return {
    items: filtered,
    rawItems: items,
    loading,
    loadingMore,
    hasMore,
    loadMore,
    error,
    filter,
    setFilter,
    search,
    setSearch,
    refetch,
    patchLocal,
    removeLocal,
    setActiveConversationId,
  };
}
