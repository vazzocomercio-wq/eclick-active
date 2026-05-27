'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Eye, Play, Heart, MessageCircle, Share2, Bookmark,
  TrendingUp, LayoutGrid,
} from 'lucide-react';
import { socialApi, type OrganicPostItem } from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const FORMAT_LABEL: Record<string, string> = {
  REELS: 'Reel', FEED: 'Post', STORY: 'Story', AD: 'Anúncio', OUTRO: 'Outro',
};
const FORMAT_TABS: { value: string | undefined; label: string }[] = [
  { value: undefined, label: 'Todos' },
  { value: 'REELS', label: 'Reels' },
  { value: 'FEED', label: 'Posts' },
  { value: 'STORY', label: 'Stories' },
];
const SORTS: { value: 'reach' | 'engagement' | 'recent' | 'score'; label: string }[] = [
  { value: 'reach', label: 'Maior alcance' },
  { value: 'score', label: 'Melhor score' },
  { value: 'engagement', label: 'Maior engajamento' },
  { value: 'recent', label: 'Mais recentes' },
];
const nf = (n: number) => n.toLocaleString('pt-BR');
function scoreColor(s: number): string {
  if (s >= 70) return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500';
  if (s >= 40) return 'border-amber-500/40 bg-amber-500/10 text-amber-500';
  return 'border-border bg-muted text-muted-foreground';
}

export default function MeusPostsPage() {
  const [posts, setPosts] = useState<OrganicPostItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [format, setFormat] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<'reach' | 'engagement' | 'recent' | 'score'>('reach');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    socialApi.intelligence
      .posts({ format, sort, limit: 120 })
      .then((r) => {
        if (!alive) return;
        setPosts(r.posts);
        setTotal(r.total);
      })
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [format, sort]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3 md:px-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social/inteligencia"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <LayoutGrid className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Meus posts</h1>
            <p className="text-xs text-muted-foreground">
              Dados individuais de cada post — alcance, views, engajamento e score
            </p>
          </div>
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as typeof sort)}
          className="rounded-md border border-border bg-background px-2 py-1.5 text-sm"
        >
          {SORTS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {/* filtro por formato */}
        <div className="mb-4 flex flex-wrap gap-1.5">
          {FORMAT_TABS.map((t) => (
            <button
              key={t.label}
              onClick={() => setFormat(t.value)}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                format === t.value
                  ? 'border-primary bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:bg-muted/40',
              )}
            >
              {t.label}
            </button>
          ))}
          {!loading && <span className="ml-1 self-center text-xs text-muted-foreground">{nf(total)} posts</span>}
        </div>

        {loading ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-8">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            <span className="text-sm text-muted-foreground">Carregando posts…</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
            Nenhum post coletado ainda. A coleta orgânica roda no SaaS (Instagram conectado) e os posts aparecem aqui
            com suas métricas individuais.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {posts.map((p) => (
              <Link
                key={p.id}
                href={`/social/posts/${p.id}`}
                className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:bg-muted/40"
              >
                <div className="relative">
                  {p.thumbnail_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.thumbnail_url} alt="" className="aspect-square w-full object-cover" />
                  ) : (
                    <div className="flex aspect-square w-full items-center justify-center bg-muted">
                      <Eye className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                    {FORMAT_LABEL[p.media_product_type ?? 'OUTRO'] ?? p.media_product_type}
                  </span>
                  <span
                    title="Score relativo (alcance + engajamento)"
                    className={cn(
                      'absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full border text-[11px] font-bold backdrop-blur',
                      scoreColor(p.score),
                    )}
                  >
                    {p.score}
                  </span>
                </div>
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="line-clamp-2 text-xs leading-snug">{p.caption || '(sem legenda)'}</p>
                  <div className="mt-auto grid grid-cols-2 gap-1 text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{nf(p.metrics.reach)}</span>
                    <span className="flex items-center gap-1"><Play className="h-3 w-3" />{nf(p.metrics.views)}</span>
                    <span className="flex items-center gap-1"><Heart className="h-3 w-3" />{nf(p.metrics.likes)}</span>
                    <span className="flex items-center gap-1"><MessageCircle className="h-3 w-3" />{nf(p.metrics.comments)}</span>
                    <span className="flex items-center gap-1"><Share2 className="h-3 w-3" />{nf(p.metrics.shares)}</span>
                    <span className="flex items-center gap-1"><Bookmark className="h-3 w-3" />{nf(p.metrics.saved)}</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-border pt-1.5 text-[10px]">
                    <span className="flex items-center gap-1 text-primary">
                      <TrendingUp className="h-3 w-3" />eng {(p.metrics.engagement_rate * 100).toFixed(2)}%
                    </span>
                    {p.published_at && (
                      <span className="text-muted-foreground">
                        {new Date(p.published_at).toLocaleDateString('pt-BR')}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
