'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  socialApi,
  type SocialBrand,
  type SocialContent,
  type SocialCalendar,
  type DashboardCounts,
  type ContentListFilters,
  type ListResponse,
} from '@/lib/api/social';
import { getSocket } from '@/lib/realtime/socket-client';

interface SocialEventPayload {
  content_id?: string;
  scheduled_for?: string;
  content_type?: string;
  title?: string | null;
}

const SOCIAL_EVENTS = [
  'social:content-ready',
  'social:scheduled-soon',
  'social:ready-to-publish',
] as const;

export function useSocialEvents(
  onAny: (event: string, payload: SocialEventPayload) => void,
): void {
  const cbRef = useRef(onAny);
  cbRef.current = onAny;
  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    void (async () => {
      const socket = await getSocket();
      if (!socket || cancelled) return;
      const handlers = SOCIAL_EVENTS.map((evt) => {
        const fn = (p: SocialEventPayload) => cbRef.current(evt, p);
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

// ─── Brands ───────────────────────────────────────

export function useBrands(): {
  brands: SocialBrand[];
  loading: boolean;
  refresh: () => void;
} {
  const [brands, setBrands] = useState<SocialBrand[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await socialApi.brands.list();
      if (aliveRef.current) setBrands(list);
    } catch {
      if (aliveRef.current) setBrands([]);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);

  return { brands, loading, refresh };
}

export function useBrand(id: string | null): {
  brand: SocialBrand | null;
  loading: boolean;
  refresh: () => void;
} {
  const [brand, setBrand] = useState<SocialBrand | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const b = await socialApi.brands.get(id);
      if (aliveRef.current) setBrand(b);
    } catch {
      if (aliveRef.current) setBrand(null);
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
  return { brand, loading, refresh };
}

// ─── Dashboard ───────────────────────────────────

export function useSocialDashboard(refreshMs = 30_000): {
  counts: DashboardCounts | null;
  loading: boolean;
  refresh: () => void;
} {
  const [counts, setCounts] = useState<DashboardCounts | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const data = await socialApi.contents.dashboard();
      if (aliveRef.current) setCounts(data);
    } catch {
      /* silent */
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    const t = setInterval(() => void refresh(), refreshMs);
    return () => {
      aliveRef.current = false;
      clearInterval(t);
    };
  }, [refresh, refreshMs]);
  useSocialEvents(() => void refresh());
  return { counts, loading, refresh };
}

// ─── Contents ───────────────────────────────────

export function useContents(filters: ContentListFilters = {}): {
  data: ListResponse<SocialContent> | null;
  loading: boolean;
  refresh: () => void;
} {
  const [data, setData] = useState<ListResponse<SocialContent> | null>(null);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);
  const filtersKey = JSON.stringify(filters);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await socialApi.contents.list(JSON.parse(filtersKey));
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
  useSocialEvents(() => void refresh());
  return { data, loading, refresh };
}

export function useContent(id: string | null): {
  content: SocialContent | null;
  loading: boolean;
  refresh: () => void;
} {
  const [content, setContent] = useState<SocialContent | null>(null);
  const [loading, setLoading] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const c = await socialApi.contents.get(id);
      if (aliveRef.current) setContent(c);
    } catch {
      if (aliveRef.current) setContent(null);
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
  useSocialEvents((_evt, p) => {
    if (id && p.content_id === id) void refresh();
  });
  return { content, loading, refresh };
}

// ─── Pending count pra sidebar badge ─────────────

export function useSocialPendingCount(): number {
  const { counts } = useSocialDashboard(60_000);
  return counts?.pending_approval ?? 0;
}

// ─── Calendars ───────────────────────────────────

export function useCalendars(brandId?: string): {
  calendars: SocialCalendar[];
  loading: boolean;
  refresh: () => void;
} {
  const [calendars, setCalendars] = useState<SocialCalendar[]>([]);
  const [loading, setLoading] = useState(true);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await socialApi.calendars.list({ brand_id: brandId });
      if (aliveRef.current) setCalendars(list);
    } catch {
      if (aliveRef.current) setCalendars([]);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [brandId]);

  useEffect(() => {
    aliveRef.current = true;
    void refresh();
    return () => {
      aliveRef.current = false;
    };
  }, [refresh]);
  return { calendars, loading, refresh };
}
