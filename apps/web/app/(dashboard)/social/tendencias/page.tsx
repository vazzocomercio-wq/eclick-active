'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Radar, RefreshCw, Loader2, Plus, Trash2, Play, TrendingUp,
  Megaphone, AtSign, Music, Sparkles, CheckCircle2, CircleDashed, Eye, DownloadCloud,
  Wand2, X, Brain, Hash,
} from 'lucide-react';
import {
  socialApi,
  type TrendsOverview,
  type TrendMonitor,
  type TrendSignal,
  type TrendItem,
  type TrendBrief,
  type TrendBriefProduct,
  type TrendNetwork,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const NETWORKS: { value: TrendNetwork; label: string }[] = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'google_trends', label: 'Google Trends' },
  { value: 'meta_ads', label: 'Meta Ad Library' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'tiktok', label: 'TikTok' },
];
const NET_LABEL: Record<string, string> = Object.fromEntries(
  NETWORKS.map((n) => [n.value, n.label]),
);
const FORMAT_LABEL: Record<string, string> = {
  reel: 'Reel', post: 'Post', carousel: 'Carrossel', story: 'Story', video: 'Vídeo',
};

/** Monta a URL do Social AI Studio pré-preenchida a partir de uma pauta (1-clique). */
function briefHref(b: TrendBrief, prod?: TrendBriefProduct): string {
  const params = new URLSearchParams({ format: b.format, theme: b.title });
  if (b.hook) params.set('hook', b.hook);
  if (prod?.product_id) params.set('product_id', prod.product_id);
  if (prod?.name) params.set('product_search', prod.name);
  return `/social/criar?${params.toString()}`;
}
function NetIcon({ source, className }: { source: TrendNetwork; className?: string }) {
  switch (source) {
    case 'youtube': return <Play className={className} />;
    case 'google_trends': return <TrendingUp className={className} />;
    case 'meta_ads': return <Megaphone className={className} />;
    case 'instagram': return <AtSign className={className} />;
    case 'tiktok': return <Music className={className} />;
    default: return <Radar className={className} />;
  }
}
const nf = (n: number) => n.toLocaleString('pt-BR');

export default function TendenciasPage() {
  const [overview, setOverview] = useState<TrendsOverview | null>(null);
  const [monitors, setMonitors] = useState<TrendMonitor[]>([]);
  const [signals, setSignals] = useState<TrendSignal[]>([]);
  const [items, setItems] = useState<TrendItem[]>([]);
  const [briefs, setBriefs] = useState<TrendBrief[]>([]);
  const [loading, setLoading] = useState(true);

  // add-monitor form
  const [showForm, setShowForm] = useState(false);
  const [fNetwork, setFNetwork] = useState<TrendNetwork>('youtube');
  const [fCategory, setFCategory] = useState('');
  const [fKeywords, setFKeywords] = useState('');
  const [saving, setSaving] = useState(false);

  // coleta
  const [collecting, setCollecting] = useState(false);
  const [collectingId, setCollectingId] = useState<string | null>(null);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    try {
      const [o, m, s, it, b] = await Promise.all([
        socialApi.trends.overview(),
        socialApi.trends.monitors(),
        socialApi.trends.signals(),
        socialApi.trends.items({ limit: 60 }),
        socialApi.trends.briefs(),
      ]);
      setOverview(o);
      setMonitors(m);
      setSignals(s);
      setItems(it);
      setBriefs(b);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const addMonitor = async () => {
    if (!fCategory.trim()) return;
    setSaving(true);
    try {
      await socialApi.trends.createMonitor({
        network: fNetwork,
        category: fCategory.trim(),
        keywords: fKeywords
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      });
      setFCategory('');
      setFKeywords('');
      setShowForm(false);
      await load();
    } catch {
      /* silent */
    } finally {
      setSaving(false);
    }
  };

  const collectAll = async () => {
    setCollecting(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.collect();
      setCollectMsg(
        r.monitors === 0
          ? 'Nenhum monitor de YouTube/Google Trends/TikTok ativo pra coletar.'
          : `Coleta concluída: ${r.items} itens de ${r.monitors} monitor(es).`,
      );
      await load();
    } catch {
      setCollectMsg('Falha na coleta. Tente novamente.');
    } finally {
      setCollecting(false);
    }
  };

  const collectMonitor = async (id: string) => {
    setCollectingId(id);
    try {
      await socialApi.trends.collectMonitor(id);
      await load();
    } catch {
      /* silent */
    } finally {
      setCollectingId(null);
    }
  };

  const generateBriefs = async () => {
    setGenerating(true);
    setCollectMsg(null);
    try {
      const r = await socialApi.trends.generate();
      setCollectMsg(
        r.briefs > 0
          ? `IA gerou ${r.briefs} pauta(s) e ${r.signals} sinal(is) a partir das tendências.`
          : 'Sem dados suficientes pra gerar pautas — colete tendências e conecte produtos primeiro.',
      );
      await load();
    } catch {
      setCollectMsg('Falha ao gerar pautas. Tente novamente.');
    } finally {
      setGenerating(false);
    }
  };

  const dismissBrief = async (id: string) => {
    setBriefs((prev) => prev.filter((b) => b.id !== id));
    try {
      await socialApi.trends.dismissBrief(id);
    } catch {
      /* silent */
    }
  };

  const removeMonitor = async (id: string) => {
    if (!confirm('Remover este monitor de tendência?')) return;
    try {
      await socialApi.trends.deleteMonitor(id);
      setMonitors((prev) => prev.filter((m) => m.id !== id));
      void load();
    } catch {
      /* silent */
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Radar className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Radar de Conteúdo</h1>
            <p className="text-xs text-muted-foreground">
              O que está bombando na sua categoria — e qual conteúdo criar a partir disso
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            <span className="ml-1">Atualizar</span>
          </Button>
          <Button size="sm" variant="outline" onClick={() => void collectAll()} disabled={collecting || loading}>
            {collecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            <span className="ml-1">{collecting ? 'Coletando…' : 'Coletar'}</span>
          </Button>
          <Button size="sm" onClick={() => void generateBriefs()} disabled={generating || loading}>
            {generating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            <span className="ml-1">{generating ? 'Gerando…' : 'Gerar pautas IA'}</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {collectMsg && (
          <div className="mb-4 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-foreground/80">
            {collectMsg}
          </div>
        )}
        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Carregando o radar…</span>
          </div>
        ) : (
          <>
            {/* ── FONTES DE TENDÊNCIA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />Fontes de tendência
                <span className="text-xs font-normal text-muted-foreground">
                  · {overview?.items ?? 0} itens coletados · {overview?.signals ?? 0} sinais
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(overview?.by_source ?? []).map((src) => (
                  <div
                    key={src.source}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-3',
                      src.status === 'live'
                        ? 'border-emerald-500/40 bg-emerald-500/5'
                        : 'border-border bg-card',
                    )}
                  >
                    <div className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                      src.status === 'live' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-muted text-muted-foreground',
                    )}>
                      <NetIcon source={src.source} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[13px] font-medium">{src.label}</span>
                        {src.status === 'live' ? (
                          <span className="flex items-center gap-0.5 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-500">
                            <CheckCircle2 className="h-2.5 w-2.5" />{nf(src.items)} itens
                          </span>
                        ) : (
                          <span className="flex items-center gap-0.5 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground">
                            <CircleDashed className="h-2.5 w-2.5" />{src.phase}
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{src.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* ── CATEGORIAS MONITORADAS ── */}
            <section className="mb-6">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold">
                  <Eye className="h-4 w-4 text-primary" />Categorias monitoradas
                  <span className="text-xs font-normal text-muted-foreground">· {monitors.length}</span>
                </h2>
                <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
                  <Plus className="h-3.5 w-3.5" /><span className="ml-1">Monitorar</span>
                </Button>
              </div>

              {showForm && (
                <div className="mb-3 flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-end">
                  <div className="flex flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Rede</label>
                    <select
                      value={fNetwork}
                      onChange={(e) => setFNetwork(e.target.value as TrendNetwork)}
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    >
                      {NETWORKS.map((n) => (
                        <option key={n.value} value={n.value}>{n.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Categoria</label>
                    <input
                      value={fCategory}
                      onChange={(e) => setFCategory(e.target.value)}
                      placeholder="ex: iluminação, decoração"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1">
                    <label className="text-[11px] text-muted-foreground">Palavras-chave (vírgula)</label>
                    <input
                      value={fKeywords}
                      onChange={(e) => setFKeywords(e.target.value)}
                      placeholder="ex: lustre, pendente, arandela"
                      className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                    />
                  </div>
                  <Button size="sm" onClick={() => void addMonitor()} disabled={saving || !fCategory.trim()}>
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    <span className="ml-1">Adicionar</span>
                  </Button>
                </div>
              )}

              {monitors.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nenhuma categoria monitorada. Adicione uma pra o radar começar a vigiar as tendências da sua área.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {monitors.map((m) => (
                    <div key={m.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                        <NetIcon source={m.network} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{m.category}</span>
                          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                            {NET_LABEL[m.network] ?? m.network}
                          </span>
                          {!m.is_active && (
                            <span className="rounded-full bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-500">pausado</span>
                          )}
                        </div>
                        {m.keywords.length > 0 && (
                          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                            {m.keywords.join(' · ')}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {m.last_collected_at
                          ? `coletado ${new Date(m.last_collected_at).toLocaleDateString('pt-BR')}`
                          : 'aguardando coleta'}
                      </span>
                      {(m.network === 'youtube' || m.network === 'google_trends' || m.network === 'tiktok' || m.network === 'meta_ads' || m.network === 'instagram') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => void collectMonitor(m.id)}
                          disabled={collectingId === m.id}
                          title="Coletar agora"
                        >
                          {collectingId === m.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <DownloadCloud className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      )}
                      <Button variant="ghost" size="sm" onClick={() => void removeMonitor(m.id)} title="Remover">
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── SINAIS DE TENDÊNCIA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-primary" />Sinais de tendência
              </h2>
              {signals.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem sinais ainda. Quando os conectores forem ligados (YouTube, Meta Ad Library, TikTok), o radar
                  vai destacar aqui os formatos, sons, temas e criativos em alta na sua categoria.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {signals.map((s) => (
                    <div key={s.id} className="rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center gap-2">
                        <NetIcon source={s.source} className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-[13px] font-medium">{s.title}</span>
                      </div>
                      {s.summary && <p className="mt-1 text-xs text-muted-foreground">{s.summary}</p>}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* ── ITENS INDIVIDUAIS (o que está bombando) ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-primary" />O que está bombando
                <span className="text-xs font-normal text-muted-foreground">· dados individuais por item</span>
              </h2>
              {items.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Nenhum item coletado ainda. Cada vídeo, criativo e som monitorado vai aparecer aqui com suas
                  métricas individuais (views, likes, duração, etc.).
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {items.map((it) => (
                    <a
                      key={it.id}
                      href={it.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-muted/40"
                    >
                      {it.thumbnail_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={it.thumbnail_url} alt="" className="aspect-video w-full object-cover" />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center bg-muted">
                          <NetIcon source={it.source} className="h-6 w-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex flex-1 flex-col gap-1 p-2">
                        <p className="line-clamp-2 text-[11px] font-medium leading-snug">{it.title ?? '(sem título)'}</p>
                        <p className="mt-auto text-[10px] text-muted-foreground">
                          {it.metrics.views != null ? `${nf(it.metrics.views)} views` : NET_LABEL[it.source] ?? it.source}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              )}
            </section>

            {/* ── PAUTAS (BRIEFS) DA IA ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Brain className="h-4 w-4 text-primary" />Pautas da IA
                <span className="text-xs font-normal text-muted-foreground">· tendência × engajamento × comércio</span>
              </h2>
              {briefs.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem pautas ainda. Clique em <span className="font-medium">Gerar pautas IA</span> — a IA cruza as
                  tendências coletadas com o que engaja no seu público e os produtos com boa margem/estoque, e te diz o que postar.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {briefs.map((b) => {
                    const prods = (b.suggested_products as TrendBriefProduct[]) ?? [];
                    const prod = prods[0];
                    return (
                      <div key={b.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
                        <div className="flex items-start gap-2">
                          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                            {FORMAT_LABEL[b.format] ?? b.format}
                          </span>
                          {b.category && (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{b.category}</span>
                          )}
                          <button
                            onClick={() => void dismissBrief(b.id)}
                            className="ml-auto text-muted-foreground hover:text-foreground"
                            title="Descartar"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <p className="text-[13px] font-semibold leading-snug">{b.title}</p>
                        {b.hook && <p className="text-xs italic text-foreground/80">“{b.hook}”</p>}
                        {b.rationale && (
                          <p className="text-xs leading-relaxed text-muted-foreground">{b.rationale}</p>
                        )}
                        {prods.length > 0 && (
                          <div className="flex items-center gap-2">
                            {prod?.photo_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={prod.photo_url} alt="" className="h-8 w-8 rounded object-cover" />
                            ) : null}
                            <span className="truncate text-[11px] text-muted-foreground">
                              {prods.map((p) => p.name).join(' · ')}
                            </span>
                          </div>
                        )}
                        {b.hashtags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {b.hashtags.slice(0, 6).map((h, i) => (
                              <span key={i} className="flex items-center gap-0.5 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                <Hash className="h-2.5 w-2.5" />{h.replace(/^#/, '')}
                              </span>
                            ))}
                          </div>
                        )}
                        <Button size="sm" className="mt-auto w-full" asChild>
                          <Link href={briefHref(b, prod)}>
                            <Wand2 className="h-3.5 w-3.5" />
                            <span className="ml-1">Gerar conteúdo</span>
                          </Link>
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <p className="text-[11px] text-muted-foreground">
              O Radar evolui em fases: conectores YouTube + Google Trends (TR-1), Meta Ad Library + Instagram (TR-2),
              briefs de conteúdo com IA (TR-3) e TikTok (TR-5).
            </p>
          </>
        )}
      </div>
    </div>
  );
}
