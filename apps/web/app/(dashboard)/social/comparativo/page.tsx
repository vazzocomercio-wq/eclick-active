'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  GitCompareArrows,
  TrendingUp,
  Eye,
  Heart,
  MessageSquare,
  Bookmark,
  Crown,
} from 'lucide-react';
import { useBrands } from '@/hooks/use-social';
import {
  socialApi,
  type SocialBrand,
  type ReportSummary,
  type PillarReportRow,
  type TopPerformerRow,
} from '@/lib/api/social';
import { Button } from '@/components/ui/button';
import { socialLabels } from '@/components/social/social-badges';
import { cn } from '@/lib/utils';

interface BrandSnapshot {
  brand: SocialBrand;
  summary: ReportSummary;
  pillars: PillarReportRow[];
  topPost: TopPerformerRow | null;
}

/**
 * Tela de comparativo multi-marca pra agências. Carrega summary/pillars/
 * top-performers pra cada marca selecionada e mostra side-by-side.
 *
 * Útil pra: "qual marca está crescendo mais?", "qual pilar funciona em
 * cada marca?", "quem está respondendo melhor à estratégia atual?".
 */
export default function ComparativoPage() {
  const { brands } = useBrands();
  const [days, setDays] = useState(30);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [snapshots, setSnapshots] = useState<BrandSnapshot[]>([]);
  const [loading, setLoading] = useState(false);

  // Auto-seleciona até 4 marcas ativas no carregamento inicial
  useEffect(() => {
    if (selectedIds.length === 0 && brands.length > 0) {
      setSelectedIds(
        brands
          .filter((b) => b.is_active)
          .slice(0, 4)
          .map((b) => b.id),
      );
    }
  }, [brands, selectedIds.length]);

  useEffect(() => {
    if (selectedIds.length === 0) {
      setSnapshots([]);
      return;
    }
    setLoading(true);
    void Promise.all(
      selectedIds.map(async (brandId) => {
        const brand = brands.find((b) => b.id === brandId);
        if (!brand) return null;
        const [summary, pillars, top] = await Promise.all([
          socialApi.reports.summary({ brand_id: brandId, days }),
          socialApi.reports.byPillar({ brand_id: brandId, days }),
          socialApi.reports.topPerformers({ brand_id: brandId, days, limit: 1 }),
        ]);
        return { brand, summary, pillars, topPost: top[0] ?? null };
      }),
    )
      .then((results) => {
        const valid = results.filter((r): r is BrandSnapshot => r !== null);
        setSnapshots(valid);
      })
      .finally(() => setLoading(false));
  }, [selectedIds, brands, days]);

  // Identifica leaders por categoria pra crown
  const leaders = useMemo(() => {
    if (snapshots.length === 0) return null;
    const reachLeader = [...snapshots].sort(
      (a, b) => b.summary.total_reach - a.summary.total_reach,
    )[0];
    const engagementLeader = [...snapshots].sort(
      (a, b) => b.summary.avg_engagement_rate - a.summary.avg_engagement_rate,
    )[0];
    const followsLeader = [...snapshots].sort(
      (a, b) => b.summary.total_profile_follows - a.summary.total_profile_follows,
    )[0];
    return {
      reach: reachLeader?.brand.id,
      engagement: engagementLeader?.brand.id,
      follows: followsLeader?.brand.id,
    };
  }, [snapshots]);

  const toggleBrand = (id: string) => {
    setSelectedIds((s) =>
      s.includes(id) ? s.filter((x) => x !== id) : [...s, id].slice(0, 6),
    );
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-background px-4 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/social">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <GitCompareArrows className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Comparativo de marcas</h1>
            <p className="text-xs text-muted-foreground">
              Side-by-side de até 6 marcas
            </p>
          </div>
        </div>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-md border border-border bg-background px-2 py-1 text-xs"
        >
          <option value={7}>7 dias</option>
          <option value={14}>14 dias</option>
          <option value={30}>30 dias</option>
          <option value={90}>90 dias</option>
        </select>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {brands.length < 2 ? (
          <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center">
            <GitCompareArrows className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Crie pelo menos 2 marcas pra comparar.
            </p>
            <Button size="sm" className="mt-3" asChild>
              <Link href="/social/marcas">Gerenciar marcas</Link>
            </Button>
          </div>
        ) : (
          <>
            {/* Seletor de marcas */}
            <section className="mb-4">
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Marcas no comparativo (até 6)
              </p>
              <div className="flex flex-wrap gap-2">
                {brands.map((b) => {
                  const active = selectedIds.includes(b.id);
                  return (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => toggleBrand(b.id)}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors',
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-background text-muted-foreground hover:border-primary/40',
                      )}
                    >
                      <span
                        className="inline-block h-3 w-3 rounded-full border border-border/40"
                        style={{
                          background: `linear-gradient(135deg, ${b.primary_color}, ${b.secondary_color})`,
                        }}
                      />
                      {b.name}
                    </button>
                  );
                })}
              </div>
            </section>

            {loading && (
              <p className="text-sm text-muted-foreground">Carregando comparativo…</p>
            )}

            {!loading && snapshots.length === 0 && (
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                Selecione marcas acima pra ver o comparativo
              </div>
            )}

            {/* Cards side-by-side */}
            {snapshots.length > 0 && (
              <>
                <section
                  className={cn(
                    'mb-6 grid gap-3',
                    snapshots.length === 1 && 'grid-cols-1',
                    snapshots.length === 2 && 'grid-cols-1 md:grid-cols-2',
                    snapshots.length === 3 && 'grid-cols-1 md:grid-cols-3',
                    snapshots.length >= 4 && 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
                  )}
                >
                  {snapshots.map((snap) => (
                    <BrandCard
                      key={snap.brand.id}
                      snapshot={snap}
                      isReachLeader={leaders?.reach === snap.brand.id}
                      isEngagementLeader={leaders?.engagement === snap.brand.id}
                      isFollowsLeader={leaders?.follows === snap.brand.id}
                    />
                  ))}
                </section>

                {/* Tabela comparativa de pilares */}
                <section className="rounded-xl border border-border bg-card p-4">
                  <h2 className="mb-3 text-sm font-semibold">
                    Engagement por pilar — comparativo
                  </h2>
                  <PillarComparisonTable snapshots={snapshots} />
                </section>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface BrandCardProps {
  snapshot: BrandSnapshot;
  isReachLeader: boolean;
  isEngagementLeader: boolean;
  isFollowsLeader: boolean;
}

function BrandCard({
  snapshot,
  isReachLeader,
  isEngagementLeader,
  isFollowsLeader,
}: BrandCardProps) {
  const { brand, summary, pillars, topPost } = snapshot;
  const bestPillar = pillars[0];
  const isLeader = isReachLeader || isEngagementLeader || isFollowsLeader;

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4',
        isLeader ? 'border-amber-500/50' : 'border-border',
      )}
    >
      {/* Header marca */}
      <div className="flex items-center gap-2">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-sm font-bold text-white"
          style={{
            background: `linear-gradient(135deg, ${brand.primary_color}, ${brand.secondary_color})`,
          }}
        >
          {brand.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="truncate text-sm font-semibold">{brand.name}</h3>
          {brand.niche && (
            <p className="truncate text-[10px] text-muted-foreground">{brand.niche}</p>
          )}
        </div>
      </div>

      {/* Métricas com crowns */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <Metric
          icon={Eye}
          label="Alcance"
          value={fmtNum(summary.total_reach)}
          isLeader={isReachLeader}
        />
        <Metric
          icon={TrendingUp}
          label="Engagement"
          value={`${(summary.avg_engagement_rate * 100).toFixed(2)}%`}
          isLeader={isEngagementLeader}
        />
        <Metric
          icon={Heart}
          label="Follows"
          value={fmtNum(summary.total_profile_follows)}
          isLeader={isFollowsLeader}
        />
      </div>

      {/* Detalhes secundários */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <MessageSquare className="h-3 w-3" />
          {fmtNum(summary.total_comments)} coments
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Bookmark className="h-3 w-3" />
          {fmtNum(summary.total_saved)} salvos
        </div>
      </div>

      {/* Best pillar */}
      {bestPillar && (
        <div className="rounded-md border border-cyan-500/30 bg-cyan-500/5 p-2 text-xs">
          <p className="text-[10px] uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            Pilar campeão
          </p>
          <p className="mt-0.5 font-medium">
            {socialLabels.pillar[bestPillar.pillar as keyof typeof socialLabels.pillar] ??
              bestPillar.pillar}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {(bestPillar.avg_engagement_rate * 100).toFixed(2)}% · {bestPillar.total_posts} posts
          </p>
        </div>
      )}

      {/* Top post */}
      {topPost && (
        <Link
          href={`/social/conteudo/${topPost.content_id}`}
          className="flex items-center gap-2 rounded-md border border-border bg-background p-2 transition-colors hover:border-primary/40"
        >
          {topPost.cover_image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={topPost.cover_image_url}
              alt=""
              className="h-10 w-10 shrink-0 rounded object-cover"
            />
          ) : (
            <div className="h-10 w-10 shrink-0 rounded bg-muted" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Top post
            </p>
            <p className="line-clamp-1 text-xs">{topPost.title ?? '—'}</p>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400">
              {(topPost.avg_engagement_rate * 100).toFixed(2)}% engagement
            </p>
          </div>
        </Link>
      )}

      <p className="text-[10px] text-muted-foreground">
        {summary.posts_with_metrics} post(s) com métricas no período
      </p>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  isLeader,
}: {
  icon: typeof Eye;
  label: string;
  value: string;
  isLeader?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border p-2',
        isLeader
          ? 'border-amber-500/50 bg-amber-500/5'
          : 'border-border bg-background',
      )}
    >
      <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground">
        {isLeader && <Crown className="h-2.5 w-2.5 text-amber-500" />}
        <Icon className="h-2.5 w-2.5" />
        {label}
      </div>
      <p
        className={cn(
          'mt-0.5 font-mono text-sm font-semibold leading-none',
          isLeader && 'text-amber-700 dark:text-amber-400',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function PillarComparisonTable({ snapshots }: { snapshots: BrandSnapshot[] }) {
  // Agrupa pilares de todas as marcas
  const allPillars = Array.from(
    new Set(
      snapshots.flatMap((s) => s.pillars.map((p) => p.pillar)),
    ),
  );

  if (allPillars.length === 0) {
    return <p className="text-xs text-muted-foreground">Sem dados de pilar ainda</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="border-b border-border text-[10px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left">Pilar</th>
            {snapshots.map((s) => (
              <th key={s.brand.id} className="px-2 py-2 text-right">
                {s.brand.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allPillars.map((pillar) => {
            const valuesPerBrand = snapshots.map((s) => {
              const p = s.pillars.find((pp) => pp.pillar === pillar);
              return p?.avg_engagement_rate ?? 0;
            });
            const max = Math.max(...valuesPerBrand);
            return (
              <tr key={pillar} className="border-b border-border/40">
                <td className="px-2 py-2 font-medium">
                  {socialLabels.pillar[pillar as keyof typeof socialLabels.pillar] ?? pillar}
                </td>
                {snapshots.map((s, i) => {
                  const value = valuesPerBrand[i] ?? 0;
                  const isMax = value === max && value > 0;
                  return (
                    <td
                      key={s.brand.id}
                      className={cn(
                        'px-2 py-2 text-right font-mono',
                        isMax ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-muted-foreground',
                      )}
                    >
                      {(value * 100).toFixed(2)}%
                      {isMax && <span className="ml-1">👑</span>}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('pt-BR');
}
