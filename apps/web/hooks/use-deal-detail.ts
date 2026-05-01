'use client';

import { useCallback, useEffect, useState } from 'react';
import type { Deal, DealActivity } from '@eclick-active/shared';
import { dealsApi } from '@/lib/api/deals';

interface DealDetail extends Deal {
  contact?: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    avatar_url: string | null;
    temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
    score: number;
  } | null;
  company?: { id: string; name: string; domain: string | null } | null;
  pipeline?: { id: string; name: string } | null;
  stage?: {
    id: string;
    name: string;
    color: string;
    probability: number;
    is_won: boolean;
    is_lost: boolean;
  } | null;
}

interface UseDealDetailResult {
  detail: DealDetail | null;
  activities: DealActivity[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
}

export function useDealDetail(dealId: string | null): UseDealDetailResult {
  const [detail, setDetail] = useState<DealDetail | null>(null);
  const [activities, setActivities] = useState<DealActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!dealId) return;
    setLoading(true);
    setError(null);
    try {
      const [d, a] = await Promise.all([
        dealsApi.getById(dealId),
        dealsApi.getActivities(dealId),
      ]);
      setDetail(d as DealDetail);
      setActivities(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }, [dealId]);

  useEffect(() => {
    if (!dealId) {
      setDetail(null);
      setActivities([]);
      return;
    }
    void reload();
  }, [dealId, reload]);

  return { detail, activities, loading, error, reload };
}
