'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Sparkles, RefreshCw, Eye, TrendingUp, Users, Heart,
  Flame, Clock, Loader2, Wand2, CalendarDays, Lightbulb, Megaphone, DollarSign, MessageCircle,
} from 'lucide-react';
import {
  socialApi,
  type TodaysPlan,
  type IntelligenceOverview,
  type WeekPlan,
  type Recommendation,
  type AdsSummary,
  type SentimentSummary,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const BLOCKS: { label: string; hours: number[] }[] = [
  { label: 'Madrugada', hours: [0, 1, 2, 3, 4] },
  { label: 'Manhã cedo', hours: [5, 6, 7, 8] },
  { label: 'Manhã', hours: [9, 10, 11] },
  { label: 'Almoço', hours: [12, 13] },
  { label: 'Tarde', hours: [14, 15, 16, 17] },
  { label: 'Fim de tarde', hours: [18, 19, 20] },
  { label: 'Noite', hours: [21, 22, 23] },
];
const FORMAT_LABEL: Record<string, string> = { reel: 'Reel', post: 'Post', carousel: 'Carrossel', REELS: 'Reels', FEED: 'Feed', STORY: 'Story' };
const nf = (n: number) => n.toLocaleString('pt-BR');

/** Score relativo do post (0-100): blend de alcance + engajamento vs o melhor do período. */
function scoreOf(reach: number, er: number, maxReach: number, maxEr: number): number {
  const r = maxReach > 0 ? reach / maxReach : 0;
  const e = maxEr > 0 ? er / maxEr : 0;
  return Math.round((0.45 * r + 0.55 * e) * 100);
}
function scoreColor(s: number): string {
  if (s >= 70) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';
  if (s >= 40) return 'border-amber-500/40 bg-amber-500/10 text-amber-500';
  return 'border-border bg-muted text-muted-foreground';
}

export default function SocialIntelligencePage() {
  const [plan, setPlan] = useState<TodaysPlan | null>(null);
  const [overview, setOverview] = useState<IntelligenceOverview | null>(null);
  const [week, setWeek] = useState<WeekPlan | null>(null);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [ads, setAds] = useState<AdsSummary | null>(null);
  const [sentiment, setSentiment] = useState<SentimentSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    try {
      const [p, o, w, r, a, sent] = await Promise.all([
        socialApi.intelligence.today(),
        socialApi.intelligence.overview(),
        socialApi.intelligence.week(),
        socialApi.intelligence.recommendations(),
        socialApi.intelligence.ads(),
        socialApi.intelligence.sentiment(),
      ]);
      setPlan(p);
      setOverview(o);
      setWeek(w);
      setRecs(r);
      setAds(a);
      setSentiment(sent);
    } catch {
      /* silent */
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      const p = await socialApi.intelligence.refreshToday();
      setPlan(p);
      setOverview(await socialApi.intelligence.overview());
    } catch {
      /* silent */
    } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const org = overview?.organic ?? null;

  // heatmap: bloco × dia → reach (normalizado). Map evita índice possivelmente undefined.
  const grid = new Map<string, number>();
  let gridMax = 0;
  if (org) {
    for (const h of org.heatmap) {
      const bi = BLOCKS.findIndex((b) => b.hours.includes(h.hour));
      if (bi >= 0 && h.dow >= 0 && h.dow < 7) {
        const key = `${bi}-${h.dow}`;
        const v = (grid.get(key) ?? 0) + h.reach;
        grid.set(key, v);
        gridMax = Math.max(gridMax, v);
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <Sparkles className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Social Intelligence</h1>
            <p className="text-xs text-muted-foreground">
              O que postar hoje pra vender mais — orgânico + comercial cruzados pela IA
            </p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={refresh} disabled={refreshing || loading}>
          <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
          <span className="ml-1">{refreshing ? 'Recalculando…' : 'Recalcular'}</span>
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Carregando inteligência…</span>
          </div>
        ) : (
          <>
            {/* ── O QUE POSTAR HOJE ── */}
            <section className="mb-6">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Flame className="h-4 w-4 text-orange-500" />
                O que postar hoje
                {plan?.signals.best_format && (
                  <span className="text-xs font-normal text-muted-foreground">
                    · formato campeão: {FORMAT_LABEL[plan.signals.best_format] ?? plan.signals.best_format}
                    {plan.signals.best_hour != null ? ` · melhor horário ~${plan.signals.best_hour}h` : ''}
                  </span>
                )}
              </h2>
              {plan && plan.suggestions.length > 0 ? (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                  {plan.suggestions.map((s, i) => (
                    <div key={i} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                      <div className="flex items-center gap-3">
                        {s.photo_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.photo_url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
                        ) : (
                          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded bg-muted">
                            <Sparkles className="h-5 w-5 text-muted-foreground" />
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                              {FORMAT_LABEL[s.format] ?? s.format}
                            </span>
                            {i === 0 && (
                              <span className="rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-semibold text-orange-500">
                                Aposta do dia
                              </span>
                            )}
                            {s.best_time && (
                              <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                <Clock className="h-3 w-3" />{s.best_time}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 truncate text-xs font-medium" title={s.product_name}>{s.product_name}</p>
                        </div>
                      </div>
                      <p className="text-[13px] font-medium leading-snug">{s.angle}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">{s.why}</p>
                      <Button size="sm" className="mt-auto w-full" asChild>
                        <Link href="/social/criar">
                          <Wand2 className="h-3.5 w-3.5" />
                          <span className="ml-1">Gerar agora</span>
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-sm text-muted-foreground">
                  Sem sugestões ainda — conecte produtos/coleta de métricas e clique em “Recalcular”.
                </div>
              )}
            </section>

            {/* ── RECOMENDAÇÕES ── */}
            {recs.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Lightbulb className="h-4 w-4 text-amber-500" />Recomendações
                </h2>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {recs.map((r) => (
                    <div
                      key={r.id}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3',
                        r.severity === 'warning'
                          ? 'border-amber-500/40 bg-amber-500/5'
                          : r.severity === 'opportunity'
                            ? 'border-primary/30 bg-primary/5'
                            : 'border-border bg-card',
                      )}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] font-medium">{r.title}</p>
                        {r.detail && <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>}
                      </div>
                      {r.action && (
                        <Button size="sm" variant="outline" asChild className="shrink-0">
                          <Link href={r.action.href}>{r.action.label}</Link>
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── PLANO DA SEMANA ── */}
            {week && week.days.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <CalendarDays className="h-4 w-4 text-primary" />Plano da semana
                  <span className="text-xs font-normal text-muted-foreground">· a IA montou com base em produtos + engajamento</span>
                </h2>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-7">
                  {week.days.map((d, i) => (
                    <div key={i} className="flex flex-col gap-1 rounded-lg border border-border bg-card p-3">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs font-semibold">{d.weekday}</span>
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold text-primary">{FORMAT_LABEL[d.format] ?? d.format}</span>
                      </div>
                      <p className="text-[11px] font-medium leading-snug" title={d.product_name}>{d.product_name}</p>
                      <p className="text-[11px] leading-snug text-muted-foreground">{d.angle}</p>
                      {d.best_time && (
                        <span className="mt-auto flex items-center gap-0.5 pt-1 text-[10px] text-muted-foreground">
                          <Clock className="h-3 w-3" />{d.best_time}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* ── KPIs EXECUTIVOS ── */}
            {org && (
              <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi icon={<Eye className="h-4 w-4" />} label="Alcance (30d)" value={nf(org.totals.reach)} hint={`${org.totals.posts} posts`} />
                <Kpi icon={<TrendingUp className="h-4 w-4" />} label="Visualizações" value={nf(org.totals.views)} />
                <Kpi icon={<Heart className="h-4 w-4" />} label="Engajamento" value={nf(org.totals.engagement)} hint={`taxa ${(org.totals.avg_engagement_rate * 100).toFixed(2)}%`} />
                <Kpi icon={<Users className="h-4 w-4" />} label="Seguidores" value={nf(org.totals.followers)} hint={`${nf(org.totals.profile_views)} visitas ao perfil`} />
              </section>
            )}

            {/* ── ADS (Meta/Google) ── */}
            {ads && ads.connected_accounts > 0 && (
              <section className="mb-6">
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Megaphone className="h-4 w-4 text-primary" />Anúncios
                  <span className="text-xs font-normal text-muted-foreground">· {ads.connected_accounts} conta(s) · últimos {ads.period_days}d</span>
                </h2>
                <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <Kpi icon={<DollarSign className="h-4 w-4" />} label="Investido" value={`R$ ${nf(ads.totals.spend)}`} hint={`${nf(ads.totals.impressions)} impressões`} />
                  <Kpi icon={<TrendingUp className="h-4 w-4" />} label="CTR" value={`${ads.totals.ctr}%`} hint={`CPM R$ ${ads.totals.cpm} · CPC R$ ${ads.totals.cpc}`} />
                  <Kpi icon={<Users className="h-4 w-4" />} label="Conversões" value={nf(ads.totals.conversions)} hint={ads.totals.cac > 0 ? `CAC R$ ${ads.totals.cac}` : undefined} />
                  <Kpi icon={<Sparkles className="h-4 w-4" />} label="ROAS" value={ads.totals.roas > 0 ? `${ads.totals.roas}x` : '—'} hint={ads.totals.roas > 0 ? undefined : 'sem conversão rastreada'} />
                </div>
                {ads.top_campaigns.length > 0 && (
                  <div className="rounded-lg border border-border bg-card p-3">
                    <p className="mb-2 text-xs font-semibold">Top campanhas (por investimento)</p>
                    <div className="flex flex-col gap-1">
                      {ads.top_campaigns.map((c, i) => (
                        <div key={i} className="flex items-center justify-between gap-2 text-xs">
                          <span className="min-w-0 truncate">
                            <span className="uppercase text-muted-foreground">{c.platform}</span> · {c.name}
                            {c.status !== 'ACTIVE' && <span className="ml-1 text-[10px] text-muted-foreground">({c.status})</span>}
                          </span>
                          <span className="shrink-0 text-muted-foreground">
                            R$ {nf(c.spend)} · CTR {c.ctr}%{c.conversions > 0 ? ` · ${c.conversions} conv` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>
            )}

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* ── HEATMAP ── */}
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <Clock className="h-4 w-4 text-primary" />Melhores horários (alcance)
                </h2>
                <div className="rounded-lg border border-border bg-card p-3">
                  {gridMax > 0 ? (
                    <table className="w-full border-separate" style={{ borderSpacing: '3px' }}>
                      <thead>
                        <tr>
                          <th />
                          {DOW.map((d) => <th key={d} className="text-[10px] font-medium text-muted-foreground">{d}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {BLOCKS.map((b, bi) => (
                          <tr key={b.label}>
                            <td className="pr-2 text-right text-[10px] text-muted-foreground whitespace-nowrap">{b.label}</td>
                            {DOW.map((_, di) => {
                              const v = grid.get(`${bi}-${di}`) ?? 0;
                              const op = gridMax ? v / gridMax : 0;
                              return (
                                <td key={di}>
                                  <div
                                    className="h-5 rounded"
                                    title={`${b.label} ${DOW[di]}: ${nf(v)} alcance`}
                                    style={{ backgroundColor: op > 0 ? `rgba(0,229,255,${0.12 + op * 0.7})` : 'rgba(148,163,184,0.10)' }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="py-6 text-center text-xs text-muted-foreground">Sem dados de horário ainda.</p>
                  )}
                </div>
                {/* por formato */}
                {org && org.by_format.length > 0 && (
                  <div className="mt-3 rounded-lg border border-border bg-card p-3">
                    <p className="mb-2 text-xs font-semibold">Por formato</p>
                    {org.by_format.map((f) => (
                      <div key={f.format} className="flex items-center justify-between py-0.5 text-xs">
                        <span>{FORMAT_LABEL[f.format] ?? f.format} <span className="text-muted-foreground">({f.posts})</span></span>
                        <span className="text-muted-foreground">alcance médio {nf(f.avg_reach)} · eng {(f.avg_engagement_rate * 100).toFixed(1)}%</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── TOP POSTS ── */}
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" />Top conteúdo (por alcance)
                </h2>
                <div className="rounded-lg border border-border bg-card p-3">
                  {org && org.top_posts.length > 0 ? (
                    (() => {
                      const maxReach = Math.max(...org.top_posts.map((p) => p.reach), 1);
                      const maxEr = Math.max(...org.top_posts.map((p) => p.engagement_rate), 0.0001);
                      return (
                        <div className="flex flex-col gap-2">
                          {org.top_posts.map((p, i) => {
                            const sc = scoreOf(p.reach, p.engagement_rate, maxReach, maxEr);
                            return (
                              <a
                                key={i}
                                href={p.permalink ?? '#'}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-3 rounded-md border border-border p-2 transition-colors hover:bg-muted/40"
                              >
                                {p.thumbnail_url ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={p.thumbnail_url} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                                ) : (
                                  <div className="h-10 w-10 shrink-0 rounded bg-muted" />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-xs">{p.caption || '(sem legenda)'}</p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {FORMAT_LABEL[p.type ?? ''] ?? p.type ?? 'POST'} · {nf(p.reach)} alcance · {nf(p.views)} views
                                  </p>
                                </div>
                                <span
                                  title="Score relativo do post (alcance + engajamento)"
                                  className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold', scoreColor(sc))}
                                >
                                  {sc}
                                </span>
                              </a>
                            );
                          })}
                        </div>
                      );
                    })()
                  ) : (
                    <p className="py-6 text-center text-xs text-muted-foreground">Sem posts coletados ainda.</p>
                  )}
                </div>
              </section>
            </div>

            {/* ── SENTIMENTO DOS CLIENTES ── */}
            {sentiment && sentiment.analyzed > 0 && (() => {
              const tot = sentiment.positive + sentiment.neutral + sentiment.negative || 1;
              const pp = Math.round((sentiment.positive / tot) * 100);
              const pn = Math.round((sentiment.neutral / tot) * 100);
              const pneg = Math.round((sentiment.negative / tot) * 100);
              return (
                <section className="mt-6">
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                    <MessageCircle className="h-4 w-4 text-primary" />Sentimento dos clientes
                    <span className="text-xs font-normal text-muted-foreground">· {sentiment.analyzed} mensagens</span>
                  </h2>
                  <div className="rounded-lg border border-border bg-card p-4">
                    <div className="mb-1.5 flex h-3 overflow-hidden rounded-full bg-muted">
                      <div style={{ width: `${pp}%` }} className="bg-emerald-500" />
                      <div style={{ width: `${pn}%` }} className="bg-muted-foreground/30" />
                      <div style={{ width: `${pneg}%` }} className="bg-red-500" />
                    </div>
                    <div className="flex justify-between text-[11px]">
                      <span className="text-emerald-500">Positivo {pp}%</span>
                      <span className="text-muted-foreground">Neutro {pn}%</span>
                      <span className="text-red-500">Negativo {pneg}%</span>
                    </div>
                    {sentiment.highlights.length > 0 && (
                      <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
                        {sentiment.highlights.map((h, i) => (
                          <div
                            key={i}
                            className={cn(
                              'border-l-2 pl-2 text-xs',
                              h.sentiment === 'positive' ? 'border-emerald-500' : h.sentiment === 'negative' ? 'border-red-500' : 'border-border',
                            )}
                          >
                            <span className="text-muted-foreground">{h.theme}:</span> “{h.quote}”
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>
              );
            })()}

            {plan && (
              <p className="mt-6 text-[11px] text-muted-foreground">
                Atualizado em {new Date(plan.generated_at).toLocaleString('pt-BR')}
                {plan.cached ? ' (cache do dia)' : ''}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ icon, label, value, hint }: { icon: React.ReactNode; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
