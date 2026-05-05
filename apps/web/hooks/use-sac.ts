'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  sacApi,
  type SacDashboardCounts,
  type SacListFilters,
  type SacListResponse,
  type SacTicket,
  type SacTicketAction,
  type SacSlaStats,
} from '@/lib/api/sac';
import { getSocket } from '@/lib/realtime/socket-client';

interface SacEventPayload {
  ticket?: SacTicket;
  ticket_id?: string;
  source?: string;
  reason?: string;
}

const SAC_EVENTS = [
  'sac:ticket-created',
  'sac:ticket-updated',
  'sac:ticket-resolved',
  'sac:ticket-reopened',
  'sac:ticket-escalated',
  'sac:preventive-created',
  'sac:sla-breached',
] as const;

/**
 * Subscreve nos eventos SAC do socket e chama o callback em qualquer
 * um deles — ideal pra invalidar caches/refetch globais.
 */
export function useSacEvents(onAny: (event: string, payload: SacEventPayload) => void): void {
  const cbRef = useRef(onAny);
  cbRef.current = onAny;

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;

      const handlers = SAC_EVENTS.map((evt) => {
        const fn = (payload: SacEventPayload) => cbRef.current(evt, payload);
        socket.on(evt, fn);
        return [evt, fn] as const;
      });

      cleanup = () => {
        for (const [evt, fn] of handlers) socket.off(evt, fn);
      };
    })();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);
}

// ─── Dashboard ─────────────────────────────────────

export function useSacDashboard(autoRefreshMs = 30_000): {
  counts: SacDashboardCounts | null;
  loading: boolean;
  refresh: () => void;
} {
  const [counts, setCounts] = useState<SacDashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await sacApi.dashboard();
      if (aliveRef.current) setCounts(data);
    } catch {
      // silent — dashboard não-crítico
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), autoRefreshMs);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [refresh, autoRefreshMs]);

  useSacEvents(() => void refresh());

  return { counts, loading, refresh };
}

// ─── Lista de tickets ──────────────────────────────

export function useSacTickets(filters: SacListFilters = {}): {
  data: SacListResponse | null;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<SacListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);
  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await sacApi.list(JSON.parse(filtersKey));
      if (aliveRef.current) setData(res);
    } catch {
      if (aliveRef.current) setData({ rows: [], total: 0 });
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [filtersKey]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  useSacEvents(() => void refresh());

  return { data, loading, refresh };
}

// ─── Detalhe de ticket ─────────────────────────────

export function useSacTicket(id: string | null): {
  ticket: SacTicket | null;
  actions: SacTicketAction[];
  loading: boolean;
  refresh: () => void;
} {
  const [ticket, setTicket] = useState<SacTicket | null>(null);
  const [actions, setActions] = useState<SacTicketAction[]>([]);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [t, a] = await Promise.all([
        sacApi.detail(id),
        sacApi.actions(id),
      ]);
      if (aliveRef.current) {
        setTicket(t);
        setActions(a);
      }
    } catch {
      if (aliveRef.current) {
        setTicket(null);
        setActions([]);
      }
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  useSacEvents((evt, payload) => {
    if (!id) return;
    if (
      payload.ticket?.id === id ||
      payload.ticket_id === id
    ) {
      void refresh();
    }
  });

  return { ticket, actions, loading, refresh };
}

// ─── Ticket por conversa (pro painel da inbox) ─────

export function useTicketByConversation(conversationId: string | null): {
  ticket: SacTicket | null;
  loading: boolean;
  refresh: () => void;
} {
  const [ticket, setTicket] = useState<SacTicket | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!conversationId) {
      setTicket(null);
      return;
    }
    setLoading(true);
    try {
      const t = await sacApi.byConversation(conversationId);
      if (aliveRef.current) setTicket(t);
    } catch {
      if (aliveRef.current) setTicket(null);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  useSacEvents((_evt, payload) => {
    if (
      conversationId &&
      payload.ticket?.conversation_id === conversationId
    ) {
      void refresh();
    }
  });

  return { ticket, loading, refresh };
}

// ─── Critical count (badge sidebar) ────────────────

export function useSacCriticalCount(): number {
  const { counts } = useSacDashboard(60_000);
  return counts?.critical ?? 0;
}

// ─── SLA stats ─────────────────────────────────────

export function useSacSlaStats(days = 30): { stats: SacSlaStats | null; loading: boolean } {
  const [stats, setStats] = useState<SacSlaStats | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    setLoading(true);
    sacApi.sla
      .stats(days)
      .then((s) => {
        if (aliveRef.current) setStats(s);
      })
      .catch(() => {
        if (aliveRef.current) setStats(null);
      })
      .finally(() => {
        if (aliveRef.current) setLoading(false);
      });
    return () => {
      aliveRef.current = false;
    };
  }, [days]);

  return { stats, loading };
}
