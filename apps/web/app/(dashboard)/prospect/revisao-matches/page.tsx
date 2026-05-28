'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  CheckCircle2,
  XCircle,
  GitMerge,
  AlertCircle,
} from 'lucide-react';
import { prospectApi, type MatchReviewItem } from '@/lib/api/prospect';
import { ApiError } from '@/lib/api/client';

function formatCnpj(c: string | null): string {
  if (!c || c.length !== 14) return c ?? '—';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export default function MatchReviewPage() {
  const [items, setItems] = useState<MatchReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setItems(await prospectApi.matchReview());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function decide(id: string, decision: 'merge' | 'reject') {
    setBusyId(id);
    setError(null);
    try {
      await prospectApi.resolveMatch(id, { decision });
      setItems((cur) => cur.filter((i) => i.id !== id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-4xl mx-auto">
      <Link
        href="/prospect"
        className="text-sm text-cyan-300 hover:underline mb-4 flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar pra lista
      </Link>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <GitMerge className="w-6 h-6 text-cyan-400" /> Revisão de matches
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Pares com similaridade 80–89% — humano decide. Acima de 90% o sistema mescla auto.
        </p>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-slate-500 text-sm">
          Fila vazia — nenhum match aguardando revisão.
        </div>
      ) : (
        <ul className="space-y-3">
          {items.map((m) => (
            <li key={m.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-mono">
                  similaridade {m.similarity}%
                </span>
                <span className="text-xs text-slate-500">{m.match_method}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                {[m.a, m.b].map((side, i) => (
                  <Link
                    key={i}
                    href={side ? `/prospect/${side.id}` : '#'}
                    className="rounded-lg border border-zinc-800 hover:border-cyan-500/40 p-3 transition"
                  >
                    <div className="text-sm text-white font-medium truncate">
                      {side?.display_name ?? '(sem nome)'}
                    </div>
                    <div className="text-xs text-slate-500 font-mono">{formatCnpj(side?.cnpj ?? null)}</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Score {side?.prospect_score ?? 0}
                    </div>
                  </Link>
                ))}
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => decide(m.id, 'reject')}
                  disabled={busyId === m.id}
                  className="px-3 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 text-xs flex items-center gap-1 disabled:opacity-40"
                >
                  {busyId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                  Não é a mesma
                </button>
                <button
                  onClick={() => decide(m.id, 'merge')}
                  disabled={busyId === m.id}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs flex items-center gap-1 disabled:opacity-40"
                >
                  {busyId === m.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                  Mesclar
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
