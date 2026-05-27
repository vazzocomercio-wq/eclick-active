'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Loader2, Eye, Play, Heart, MessageCircle, Share2, Bookmark,
  TrendingUp, BarChart3, ExternalLink, Sparkles, CheckCircle2, AlertTriangle, ArrowRight,
} from 'lucide-react';
import {
  socialApi,
  type OrganicPostDetail,
  type PostVerdict,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FORMAT_LABEL: Record<string, string> = {
  REELS: 'Reel', FEED: 'Post', STORY: 'Story', AD: 'Anúncio', OUTRO: 'Post',
};
const nf = (n: number) => n.toLocaleString('pt-BR');

export default function PostDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [detail, setDetail] = useState<OrganicPostDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [verdict, setVerdict] = useState<PostVerdict | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    socialApi.intelligence
      .postDetail(id)
      .then((d) => alive && setDetail(d))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [id]);

  const analyze = async () => {
    if (!id) return;
    setAnalyzing(true);
    try {
      setVerdict(await socialApi.intelligence.postVerdict(id));
    } catch {
      /* silent */
    } finally {
      setAnalyzing(false);
    }
  };

  const p = detail?.post ?? null;
  const m = p?.metrics ?? null;
  const fmt = p ? FORMAT_LABEL[p.media_product_type ?? 'OUTRO'] ?? p.media_product_type : '';
  const bench = detail?.benchmark ?? null;
  const reachVsBench =
    bench && bench.median_reach > 0 && m ? m.reach / bench.median_reach : null;
  const maxDailyReach = Math.max(...(detail?.daily ?? []).map((d) => d.reach), 1);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social/posts"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Detalhe do post</h1>
            <p className="text-xs text-muted-foreground">Métricas individuais + evolução + veredito da IA</p>
          </div>
        </div>
        {p?.permalink && (
          <Button variant="outline" size="sm" asChild>
            <a href={p.permalink} target="_blank" rel="noreferrer">
              <ExternalLink className="h-3.5 w-3.5" /><span className="ml-1">Abrir no Instagram</span>
            </a>
          </Button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Carregando…</span>
          </div>
        ) : !detail || !p || !m ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            Post não encontrado.
          </div>
        ) : (
          <>
            {/* cabeçalho do post */}
            <div className="mb-6 flex flex-col gap-4 sm:flex-row">
              {p.thumbnail_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.thumbnail_url} alt="" className="h-40 w-40 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-40 w-40 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Eye className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{fmt}</span>
                  <span
                    title="Score relativo"
                    className={cn(
                      'flex h-7 items-center rounded-full border px-2 text-[11px] font-bold',
                      p.score >= 70 ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                        : p.score >= 40 ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                          : 'border-border bg-muted text-muted-foreground',
                    )}
                  >
                    score {p.score}
                  </span>
                  {p.published_at && (
                    <span className="text-xs text-muted-foreground">
                      {new Date(p.published_at).toLocaleString('pt-BR')}
                    </span>
                  )}
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{p.caption || '(sem legenda)'}</p>
                {reachVsBench != null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Alcance{' '}
                    <span className={cn('font-semibold', reachVsBench >= 1 ? 'text-emerald-500' : 'text-amber-500')}>
                      {reachVsBench.toFixed(1)}×
                    </span>{' '}
                    {reachVsBench >= 1 ? 'acima' : 'da'} mediana de {fmt} ({nf(bench!.median_reach)})
                  </p>
                )}
              </div>
            </div>

            {/* métricas individuais */}
            <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              <Metric icon={<Eye className="h-4 w-4" />} label="Alcance" value={nf(m.reach)} />
              <Metric icon={<Play className="h-4 w-4" />} label="Visualizações" value={nf(m.views)} />
              <Metric icon={<BarChart3 className="h-4 w-4" />} label="Impressões" value={nf(m.impressions)} />
              <Metric icon={<TrendingUp className="h-4 w-4" />} label="Engajamento" value={`${(m.engagement_rate * 100).toFixed(2)}%`} />
              <Metric icon={<Heart className="h-4 w-4" />} label="Curtidas" value={nf(m.likes)} />
              <Metric icon={<MessageCircle className="h-4 w-4" />} label="Comentários" value={nf(m.comments)} />
              <Metric icon={<Share2 className="h-4 w-4" />} label="Compart." value={nf(m.shares)} />
              <Metric icon={<Bookmark className="h-4 w-4" />} label="Salvamentos" value={nf(m.saved)} />
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* evolução diária */}
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                  <TrendingUp className="h-4 w-4 text-primary" />Evolução do alcance
                </h2>
                <div className="rounded-lg border border-border bg-card p-3">
                  {detail.daily.length > 1 ? (
                    <div className="flex h-32 items-end gap-1">
                      {detail.daily.map((d, i) => (
                        <div key={i} className="flex flex-1 flex-col items-center gap-1" title={`${d.date}: ${nf(d.reach)} alcance`}>
                          <div
                            className="w-full rounded-t bg-primary/70"
                            style={{ height: `${Math.max((d.reach / maxDailyReach) * 100, 2)}%` }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-8 text-center text-xs text-muted-foreground">
                      Só uma medição até agora — a evolução aparece conforme a coleta diária roda.
                    </p>
                  )}
                </div>
              </section>

              {/* veredito IA */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold">
                    <Sparkles className="h-4 w-4 text-amber-500" />Veredito da IA
                  </h2>
                  <Button size="sm" onClick={() => void analyze()} disabled={analyzing}>
                    {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                    <span className="ml-1">{analyzing ? 'Analisando…' : verdict ? 'Reanalisar' : 'Analisar com IA'}</span>
                  </Button>
                </div>
                {verdict ? (
                  <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
                    <p className="text-sm font-medium">{verdict.headline}</p>
                    {verdict.vs_benchmark && (
                      <p className="text-xs text-primary">{verdict.vs_benchmark}</p>
                    )}
                    {verdict.what_worked.length > 0 && (
                      <div>
                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-emerald-500">
                          <CheckCircle2 className="h-3 w-3" />O que funcionou
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {verdict.what_worked.map((w, i) => (
                            <li key={i} className="text-xs text-muted-foreground">• {w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verdict.what_to_improve.length > 0 && (
                      <div>
                        <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-amber-500">
                          <AlertTriangle className="h-3 w-3" />O que melhorar
                        </p>
                        <ul className="flex flex-col gap-0.5">
                          {verdict.what_to_improve.map((w, i) => (
                            <li key={i} className="text-xs text-muted-foreground">• {w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {verdict.next_action && (
                      <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 p-2">
                        <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                        <p className="text-xs">{verdict.next_action}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center text-xs text-muted-foreground">
                    Clique em <span className="font-medium">Analisar com IA</span> pra um veredito: o que funcionou,
                    o que melhorar e a próxima ação — comparando com a mediana do formato.
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <span className="text-primary">{icon}</span>
        <span className="text-[11px]">{label}</span>
      </div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}
