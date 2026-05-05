'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxItem, Conversation, Message } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
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
  items: InboxItem[];
  loading: boolean;
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
}

const PAGE_LIMIT = 50;
/** Polling de backup — refetch silencioso enquanto a aba está visível.
 * Funciona como rede de segurança caso o socket caia ou eventos sejam perdidos. */
const POLL_INTERVAL_MS = 30_000;

export function useInbox(): UseInboxResult {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UseInboxResult['error']>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const reqIdRef = useRef(0);

  /**
   * Fetch interno — pode ser silencioso (não muda loading) pra polling
   * de backup que não atrapalha UX.
   */
  const fetchInbox = useCallback(
    async (silent = false) => {
      const reqId = ++reqIdRef.current;
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      try {
        const result = await conversationsApi.getInbox({
          limit: PAGE_LIMIT,
          ...(filter === 'mine' ? { mine: true } : {}),
          ...(filter === 'resolved' ? { status: 'resolved' } : {}),
          ...(filter === 'archived' ? { status: 'archived' } : {}),
          ...(filter === 'starred' ? { starred: true } : {}),
        });
        if (reqId !== reqIdRef.current) return;
        setItems(result.data);
        if (silent) setError(null);
      } catch (err) {
        if (reqId !== reqIdRef.current) return;
        if (err instanceof ApiError) {
          setError({ status: err.status, message: err.message });
        } else {
          setError({ status: 0, message: err instanceof Error ? err.message : 'Erro' });
        }
        if (!silent) setItems([]);
      } finally {
        if (reqId === reqIdRef.current && !silent) setLoading(false);
      }
    },
    [filter],
  );

  const refetch = useCallback(() => fetchInbox(false), [fetchInbox]);

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

          const merged: InboxItem = {
            ...prev[idx]!,
            status: updated.status,
            priority: updated.priority,
            assigned_to: updated.assigned_to,
            unread_count: updated.unread_count,
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
          const next = [...prev];
          next[idx] = {
            ...prev[idx]!,
            last_message_at:
              payload.message.created_at ??
              prev[idx]!.last_message_at ??
              new Date().toISOString(),
            last_message_text: payload.message.plain_text ?? null,
            last_message_direction: payload.message.direction,
            // Bump unread só se for inbound. Outbound (agent/bot) não conta.
            unread_count:
              payload.message.direction === 'inbound'
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
    loading,
    error,
    filter,
    setFilter,
    search,
    setSearch,
    refetch,
    patchLocal,
    removeLocal,
  };
}
