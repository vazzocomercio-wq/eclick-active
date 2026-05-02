'use client';

import { useEffect, useState } from 'react';
import { teamApi, type MemberView } from '@/lib/api/team';
import { ApiError } from '@/lib/api/client';

interface UseTeamMembersResult {
  members: MemberView[];
  loading: boolean;
  error: { status: number; message: string } | null;
  refresh: () => Promise<void>;
}

// Cache em memória — válido pela vida útil da sessão. Membros mudam
// raramente; sem revalidação automática evita re-fetch a cada drawer aberto.
let cache: MemberView[] | null = null;
let inflight: Promise<MemberView[]> | null = null;

async function fetchOnce(): Promise<MemberView[]> {
  if (cache) return cache;
  if (inflight) return inflight;
  inflight = teamApi
    .list()
    .then((rows) => {
      cache = rows;
      return rows;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/**
 * Lista de membros da org. Usado em dropdowns de atribuição (ChatActions,
 * task drawer, etc.). Compartilha um cache em memória pra evitar requests
 * repetidos quando vários componentes pedem a mesma lista.
 */
export function useTeamMembers(): UseTeamMembersResult {
  const [members, setMembers] = useState<MemberView[]>(cache ?? []);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<UseTeamMembersResult['error']>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const rows = await fetchOnce();
      setMembers(rows);
    } catch (err) {
      if (err instanceof ApiError) {
        setError({ status: err.status, message: err.message });
      } else {
        setError({ status: 0, message: err instanceof Error ? err.message : 'Erro' });
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (cache) {
      setMembers(cache);
      setLoading(false);
      return;
    }
    void load();
  }, []);

  async function refresh() {
    cache = null;
    await load();
  }

  return { members, loading, error, refresh };
}

/** Limpa cache (útil após convite/remoção de membro pra forçar refetch). */
export function invalidateTeamMembersCache() {
  cache = null;
}
