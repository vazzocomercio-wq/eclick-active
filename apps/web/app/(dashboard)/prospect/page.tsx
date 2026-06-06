'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Search,
  Sparkles,
  MapPin,
  Building2,
  Loader2,
  AlertCircle,
  Plus,
  TrendingUp,
} from 'lucide-react';
import { prospectApi, type ProspectEntity, type EntityStatus } from '@/lib/api/prospect';
import { ApiError } from '@/lib/api/client';

const STATUS_LABELS: Record<EntityStatus, { label: string; color: string }> = {
  novo:         { label: 'Novo',         color: 'bg-slate-500/15 text-slate-300 border-slate-500/30' },
  enriquecido:  { label: 'Enriquecido',  color: 'bg-blue-500/15 text-blue-300 border-blue-500/30' },
  qualificado:  { label: 'Qualificado',  color: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  promovido:    { label: 'Promovido',    color: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  descartado:   { label: 'Descartado',   color: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
};

function scoreColor(score: number): string {
  if (score >= 70) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  if (score >= 30) return 'text-blue-400';
  return 'text-slate-400';
}

function formatCnpj(c: string | null): string {
  if (!c || c.length !== 14) return c ?? '—';
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export default function ProspectListPage() {
  const [entities, setEntities] = useState<ProspectEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EntityStatus | ''>('');
  const [minScore, setMinScore] = useState<number>(0);

  // Coletor por documento (PJ via CNPJ ou PF via CPF)
  const [docType, setDocType] = useState<'pj' | 'pf'>('pj');
  const [docInput, setDocInput] = useState('');
  const [pfNameSeed, setPfNameSeed] = useState('');
  const [collecting, setCollecting] = useState(false);

  // Places discover
  const [placesQuery, setPlacesQuery] = useState('');
  const [placesRegion, setPlacesRegion] = useState('');
  const [discovering, setDiscovering] = useState(false);
  const [discoverInfo, setDiscoverInfo] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const data = await prospectApi.list({
        status: statusFilter || undefined,
        min_score: minScore || undefined,
        limit: 200,
      });
      setEntities(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, minScore]);

  async function handleCollect() {
    if (!docInput.trim()) return;
    setCollecting(true);
    setError(null);
    try {
      const body: Parameters<typeof prospectApi.collect>[0] =
        docType === 'pj'
          ? { entity_type: 'pj', cnpj: docInput.trim() }
          : ({
              entity_type: 'pf',
              cpf: docInput.trim(),
              ...(pfNameSeed.trim() ? { seed: { full_name: pfNameSeed.trim() } } : {}),
            } as Parameters<typeof prospectApi.collect>[0]);
      const res = await prospectApi.collect(body);
      setDocInput('');
      setPfNameSeed('');
      await load();
      setDiscoverInfo(`Entity ${res.status}: ${res.entity_id.slice(0, 8)}…`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao coletar');
    } finally {
      setCollecting(false);
    }
  }

  async function handleDiscover() {
    if (!placesQuery.trim()) return;
    setDiscovering(true);
    setError(null);
    setDiscoverInfo(null);
    try {
      const res = await prospectApi.discoverPlaces({
        query: placesQuery.trim(),
        region: placesRegion.trim() || undefined,
      });
      setDiscoverInfo(
        `Descobertos ${res.discovered} · criados ${res.created} · atualizados ${res.updated}` +
        (res.skipped_closed ? ` · pulados ${res.skipped_closed} (fechados)` : ''),
      );
      setPlacesQuery('');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro no Places');
    } finally {
      setDiscovering(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
    <div className="px-4 sm:px-6 py-6 max-w-7xl mx-auto">
      <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white flex items-center gap-2">
            <Sparkles className="w-7 h-7 text-cyan-400" />
            e-Click Prospect
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            Descobre, enriquece e pontua leads PJ via Receita + Places + sinais ICP.
          </p>
        </div>
        <Link
          href="/prospect/revisao-matches"
          className="px-3 py-2 rounded-lg border border-cyan-500/30 bg-cyan-500/10 text-cyan-300 text-sm hover:bg-cyan-500/20 transition flex items-center gap-2"
        >
          <TrendingUp className="w-4 h-4" /> Revisão de matches
        </Link>
      </header>

      {/* Coletores */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <div className="rounded-xl border border-cyan-500/20 bg-zinc-900/80 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-cyan-300 flex items-center gap-2">
              <Building2 className="w-4 h-4" />
              {docType === 'pj' ? 'Coletar por CNPJ (camada 0 — grátis)' : 'Coletar por CPF'}
            </h2>
            <div className="inline-flex rounded-lg border border-zinc-800 p-0.5 text-xs">
              <button
                onClick={() => { setDocType('pj'); setDocInput(''); }}
                className={`px-2 py-1 rounded ${docType === 'pj' ? 'bg-cyan-500 text-zinc-950 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                PJ
              </button>
              <button
                onClick={() => { setDocType('pf'); setDocInput(''); }}
                className={`px-2 py-1 rounded ${docType === 'pf' ? 'bg-cyan-500 text-zinc-950 font-semibold' : 'text-slate-400 hover:text-slate-200'}`}
              >
                PF
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                value={docInput}
                onChange={(e) => setDocInput(e.target.value)}
                placeholder={docType === 'pj' ? '00.000.000/0000-00' : '000.000.000-00'}
                className="flex-1 bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 focus:outline-none"
                disabled={collecting}
              />
              <button
                onClick={handleCollect}
                disabled={collecting || !docInput.trim()}
                className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm flex items-center gap-1"
              >
                {collecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Coletar
              </button>
            </div>
            {docType === 'pf' && (
              <input
                value={pfNameSeed}
                onChange={(e) => setPfNameSeed(e.target.value)}
                placeholder="Nome completo (opcional)"
                className="bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 focus:outline-none"
                disabled={collecting}
              />
            )}
          </div>
          <p className="text-xs text-slate-500 mt-2">
            {docType === 'pj'
              ? 'BrasilAPI · cache 30d · sem custo · idempotente.'
              : 'Cria entity PF + consent legítimo interesse (uso interno). Enrichment via bridge SaaS — em construção.'}
          </p>
        </div>

        <div className="rounded-xl border border-cyan-500/20 bg-zinc-900/80 p-4">
          <h2 className="text-sm font-semibold text-cyan-300 mb-3 flex items-center gap-2">
            <MapPin className="w-4 h-4" /> Descobrir via Google Places
          </h2>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={placesQuery}
              onChange={(e) => setPlacesQuery(e.target.value)}
              placeholder="ex.: cosméticos"
              className="flex-1 bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 focus:outline-none"
              disabled={discovering}
            />
            <input
              value={placesRegion}
              onChange={(e) => setPlacesRegion(e.target.value)}
              placeholder="Belo Horizonte MG"
              className="sm:w-44 bg-zinc-950 border border-zinc-800 text-white rounded-lg px-3 py-2 text-sm focus:border-cyan-500/50 focus:outline-none"
              disabled={discovering}
            />
            <button
              onClick={handleDiscover}
              disabled={discovering || !placesQuery.trim()}
              className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-40 text-zinc-950 font-semibold text-sm flex items-center gap-1"
            >
              {discovering ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
              Buscar
            </button>
          </div>
          <p className="text-xs text-slate-500 mt-2">Cap 20/chamada · ~3¢/chamada.</p>
        </div>
      </section>

      {discoverInfo && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
          {discoverInfo}
        </div>
      )}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Filtros */}
      <section className="mb-4 flex flex-wrap gap-2 items-center">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as EntityStatus | '')}
          className="bg-zinc-950 border border-zinc-800 text-slate-200 rounded-lg px-3 py-1.5 text-sm"
        >
          <option value="">Todos os status</option>
          <option value="novo">Novo</option>
          <option value="enriquecido">Enriquecido</option>
          <option value="qualificado">Qualificado</option>
          <option value="promovido">Promovido</option>
          <option value="descartado">Descartado</option>
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-400">
          Score mínimo
          <input
            type="number"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value) || 0)}
            min={0}
            max={100}
            className="w-20 bg-zinc-950 border border-zinc-800 text-slate-200 rounded-lg px-2 py-1 text-sm"
          />
        </label>
      </section>

      {/* Lista */}
      <section>
        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-500">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : entities.length === 0 ? (
          <div className="text-center py-12 text-slate-500 text-sm">
            Nenhuma entidade. Use os coletores acima pra começar.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {entities.map((e) => {
              const st = STATUS_LABELS[e.status];
              return (
                <Link
                  key={e.id}
                  href={`/prospect/${e.id}`}
                  className="rounded-xl border border-zinc-800 bg-zinc-900/60 hover:border-cyan-500/40 hover:bg-zinc-900 p-4 transition group"
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0">
                      <div className="text-white font-semibold text-sm truncate">
                        {e.display_name || e.razao_social || '(sem nome)'}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {formatCnpj(e.cnpj)}
                      </div>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full border whitespace-nowrap ${st.color}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <div>
                      <div className={`text-2xl font-bold ${scoreColor(e.prospect_score)}`}>
                        {e.prospect_score}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-500">
                        Prospect Score
                      </div>
                    </div>
                    {e.cnae && (
                      <span className="text-[10px] text-slate-500 font-mono">
                        CNAE {e.cnae.slice(0, 4)}
                      </span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
    </div>
  );
}
