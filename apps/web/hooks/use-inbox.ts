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
}

const PAGE_LIMIT = 50;

export function useInbox(): UseInboxResult {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<UseInboxResult['error']>(null);
  const [filter, setFilter] = useState<InboxFilter>('all');
  const [search, setSearch] = useState('');
  const reqIdRef = useRef(0);

  const refetch = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    setError(null);
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
    } catch (err) {
      if (reqId !== reqIdRef.current) return;
      if (err instanceof ApiError) {
        setError({ status: err.status, message: err.message });
      } else {
        setError({ status: 0, message: err instanceof Error ? err.message : 'Erro' });
      }
      setItems([]);
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

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
        // Atualização incremental — bumpa last_message_at e re-sort.
        // unread_count e last_message_preview vêm depois via conversation:updated
        // (trigger SQL atualiza conversa logo após insert da mensagem).
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
  };
}
