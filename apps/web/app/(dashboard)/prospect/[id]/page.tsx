'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Sparkles,
  Loader2,
  AlertCircle,
  Phone,
  Mail,
  Globe,
  Building,
  CheckCircle2,
  XCircle,
  Send,
  Calculator,
  Layers,
  Shield,
} from 'lucide-react';
import {
  prospectApi,
  type ProspectProfile,
  type ScoreBreakdown,
  type PromoteResult,
} from '@/lib/api/prospect';
import { ApiError } from '@/lib/api/client';

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

const ICON_BY_KIND: Record<string, typeof Phone> = {
  phone: Phone,
  whatsapp: Phone,
  email: Mail,
  site: Globe,
  instagram: Globe,
  linkedin: Building,
};

export default function ProspectProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [profile, setProfile] = useState<ProspectProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [breakdown, setBreakdown] = useState<ScoreBreakdown | null>(null);
  const [promoteResult, setPromoteResult] = useState<PromoteResult | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setProfile(await prospectApi.get(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro ao carregar');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleScore() {
    setBusy('score');
    try {
      const result = await prospectApi.score(id);
      setBreakdown(result);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  async function handleEnrich(layer: 0 | 1 | 2) {
    setBusy(`enrich-${layer}`);
    try {
      const r = await prospectApi.enrich(id, { target_layer: layer });
      if (r.gate_reason) {
        setError(`Gate bloqueou: ${r.gate_reason}. Score atual insuficiente pra camada ${layer}.`);
      } else {
        await load();
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  async function handlePromote() {
    setBusy('promote');
    setError(null);
    try {
      const r = await prospectApi.promote(id);
      setPromoteResult(r);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  async function handleOptOut() {
    if (!confirm('Confirma registrar opt-out? Essa entidade não poderá mais ser promovida.')) return;
    setBusy('optout');
    try {
      await prospectApi.optOut(id, 'Solicitado internamente pela equipe');
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Erro');
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (error && !profile) {
    return (
      <div className="px-4 py-6 max-w-3xl mx-auto">
        <button
          onClick={() => router.push('/prospect')}
          className="text-sm text-cyan-300 hover:underline mb-4 flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Voltar
        </button>
        <div className="p-4 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200">
          {error}
        </div>
      </div>
    );
  }

  if (!profile) return null;
  const { entity, contacts, signals, consent_ledger, provenance } = profile;
  const hasOptOut = consent_ledger.some((c) => c.opt_out_at);
  const isPromoted = entity.status === 'promovido';

  return (
    <div className="h-full overflow-y-auto scrollbar-thin">
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      <button
        onClick={() => router.push('/prospect')}
        className="text-sm text-cyan-300 hover:underline mb-4 flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Voltar pra lista
      </button>

      {/* Card premium — header */}
      <header className="rounded-2xl border border-cyan-500/30 bg-gradient-to-br from-zinc-900 to-zinc-950 p-5 sm:p-6 mb-5">
        <div className="flex flex-col sm:flex-row items-start sm:justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold text-white mb-1 truncate flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyan-400 flex-shrink-0" />
              {entity.display_name || entity.razao_social || '(sem nome)'}
            </h1>
            <div className="text-sm text-slate-400 space-y-0.5">
              {entity.razao_social && entity.nome_fantasia && (
                <div>Razão: {entity.razao_social}</div>
              )}
              <div className="font-mono text-xs">CNPJ {formatCnpj(entity.cnpj)}</div>
              {entity.cnae && <div className="text-xs">CNAE {entity.cnae} · {entity.porte ?? '—'}</div>}
              {entity.situacao && <div className="text-xs">Situação: {entity.situacao}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className={`text-4xl sm:text-5xl font-bold ${scoreColor(entity.prospect_score)}`}>
              {entity.prospect_score}
            </div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500">
              Prospect Score
            </div>
            <div className="mt-2 text-xs text-slate-400">
              Confiança: {entity.confidence_score}/100
            </div>
          </div>
        </div>

        {/* Ações */}
        <div className="mt-5 pt-4 border-t border-zinc-800 flex flex-wrap gap-2">
          <button
            onClick={handleScore}
            disabled={busy === 'score'}
            className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-cyan-500/50 text-slate-200 text-xs flex items-center gap-1 disabled:opacity-40"
          >
            {busy === 'score' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Calculator className="w-3 h-3" />}
            Recalcular score
          </button>
          {[0, 1, 2].map((l) => (
            <button
              key={l}
              onClick={() => handleEnrich(l as 0 | 1 | 2)}
              disabled={busy === `enrich-${l}`}
              className="px-3 py-1.5 rounded-lg border border-zinc-700 hover:border-cyan-500/50 text-slate-200 text-xs flex items-center gap-1 disabled:opacity-40"
            >
              {busy === `enrich-${l}` ? <Loader2 className="w-3 h-3 animate-spin" /> : <Layers className="w-3 h-3" />}
              Enriquecer L{l}
            </button>
          ))}
          {!hasOptOut && !isPromoted && (
            <button
              onClick={handlePromote}
              disabled={busy === 'promote'}
              className="ml-auto px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-semibold text-xs flex items-center gap-1 disabled:opacity-40"
            >
              {busy === 'promote' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
              Promover pro Active
            </button>
          )}
          {!hasOptOut && (
            <button
              onClick={handleOptOut}
              disabled={busy === 'optout'}
              className="px-3 py-1.5 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-rose-300 text-xs flex items-center gap-1 disabled:opacity-40"
            >
              <Shield className="w-3 h-3" /> Opt-out
            </button>
          )}
        </div>

        {hasOptOut && (
          <div className="mt-3 p-2 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center gap-2">
            <XCircle className="w-4 h-4" /> Opt-out registrado — promoção bloqueada.
          </div>
        )}
        {isPromoted && (
          <div className="mt-3 p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            Promovido pro Active em {new Date(entity.promoted_at!).toLocaleString('pt-BR')}
          </div>
        )}
      </header>

      {/* Feedback inline */}
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-200 text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {promoteResult && (
        <div className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
          <div className="text-sm font-semibold text-emerald-300 mb-2">
            Promovido com sucesso
          </div>
          <pre className="text-xs text-emerald-200/80 whitespace-pre-wrap font-sans">
            {promoteResult.ai_pitch}
          </pre>
          <div className="mt-2 flex gap-3 text-xs text-slate-400">
            <Link
              href={`/contatos/${promoteResult.contact_id}`}
              className="text-cyan-300 hover:underline"
            >
              Ver contato
            </Link>
            <Link
              href={`/funis/deal/${promoteResult.deal_id}`}
              className="text-cyan-300 hover:underline"
            >
              Ver no funil
            </Link>
          </div>
        </div>
      )}

      {/* Breakdown do score */}
      {breakdown && (
        <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">
            Como foi pontuado ({breakdown.score_before} → {breakdown.score_after})
          </h2>
          <ul className="space-y-2 text-sm">
            {breakdown.breakdown.length === 0 ? (
              <li className="text-slate-500 text-xs">Nenhum sinal aplicável.</li>
            ) : (
              breakdown.breakdown.map((b, i) => (
                <li key={i} className="flex items-baseline gap-3 text-slate-300">
                  <span className="font-mono text-cyan-300 w-12">+{b.weight}</span>
                  <span className="font-medium">{b.signal}</span>
                  <span className="text-slate-500 text-xs">{b.reason}</span>
                </li>
              ))
            )}
          </ul>
        </section>
      )}

      {/* Sinais */}
      <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">Sinais</h2>
        {signals.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum sinal coletado.</div>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {signals.map((s) => (
              <li key={s.id} className="flex items-baseline justify-between gap-2 text-slate-300">
                <span className="font-medium">{s.signal_type}</span>
                <span className="text-xs text-slate-500 font-mono">peso {s.weight}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Contatos */}
      <section className="mb-5 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold text-slate-200 mb-3">Contatos</h2>
        {contacts.length === 0 ? (
          <div className="text-xs text-slate-500">Nenhum contato.</div>
        ) : (
          <ul className="space-y-2 text-sm">
            {contacts.map((c) => {
              const Icon = ICON_BY_KIND[c.kind] ?? Globe;
              return (
                <li key={c.id} className="flex items-center gap-3 text-slate-300">
                  <Icon className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                  <span className="truncate">{c.value}</span>
                  {c.is_pii && (
                    <span className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/30 px-1.5 rounded">
                      PII
                    </span>
                  )}
                  <span className="text-xs text-slate-500 ml-auto">
                    {c.validated_in}× · {c.confidence}%
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Provenance + Consent */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Fontes (provenance)</h2>
          {provenance.length === 0 ? (
            <div className="text-xs text-slate-500">Sem provenance.</div>
          ) : (
            <ul className="space-y-1.5 text-xs text-slate-300">
              {provenance.map((p) => (
                <li key={p.id} className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{p.raw_record?.source_id ?? '?'}</span>
                  <span className="text-slate-500 font-mono">
                    {p.match_method} · {p.match_confidence}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold text-slate-200 mb-3">Base legal (LGPD)</h2>
          {consent_ledger.length === 0 ? (
            <div className="text-xs text-slate-500">Sem registro.</div>
          ) : (
            <ul className="space-y-1.5 text-xs text-slate-300">
              {consent_ledger.map((c) => (
                <li key={c.id}>
                  <div className="font-medium">{c.legal_basis}</div>
                  <div className="text-slate-500">
                    {c.subject_kind} · {c.origin}
                    {c.opt_out_at && <span className="text-rose-400"> · opt-out</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
    </div>
  );
}
