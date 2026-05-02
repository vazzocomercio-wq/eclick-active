'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { InboxItem, Conversation } from '@eclick-active/shared';
import { conversationsApi } from '@/lib/api/conversations';
import { ApiError } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

export type InboxFilter = 'all' | 'mine' | 'unassigned' | 'resolved';

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

  // Realtime: escuta mudanças em active.conversations
  useEffect(() => {
    let supabase;
    try {
      supabase = createClient();
    } catch {
      return; // Sem env Supabase, sem realtime
    }
    const channel = supabase
      .channel('inbox-conversations')
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'INSERT', schema: 'active', table: 'conversations' },
        () => {
          void refetch();
        },
      )
      .on(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        'postgres_changes' as any,
        { event: 'UPDATE', schema: 'active', table: 'conversations' },
        (payload: { new: Conversation }) => {
          const updated = payload.new;
          setItems((prev) => {
            const idx = prev.findIndex((i) => i.id === updated.id);
            if (idx === -1) return prev;
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
            // Re-sort by last_message_at desc
            return next.sort((a, b) =>
              (b.last_message_at ?? b.created_at).localeCompare(
                a.last_message_at ?? a.created_at,
              ),
            );
          });
        },
      )
      .subscribe();

    return () => {
      void channel.unsubscribe();
    };
  }, [refetch]);

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
