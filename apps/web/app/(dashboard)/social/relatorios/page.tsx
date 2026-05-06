'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  BarChart3,
  RefreshCw,
  Sparkles,
  TrendingUp,
  Eye,
  Heart,
  MessageSquare,
  Share2,
  Bookmark,
  AlertTriangle,
  CheckCircle2,
  Megaphone,
} from 'lucide-react';
import {
  socialApi,
  type ReportSummary,
  type PillarReportRow,
  type HourReportRow,
  type TopPerformerRow,
  type SocialSignal,
  type HashtagTopRow,
} from '@/lib/api/social';
import { useBrands } from '@/hooks/use-social';
import { Button } from '@/components/ui/button';
import { ContentCard } from '@/components/social/content-card';
import { socialLabels } from '@/components/social/social-badges';
import { BoostDialog } from '@/components/social/boost-dialog';
import { cn } from '@/lib/utils';

export default function SocialReportsPage() {
  const { brands } = useBrands();
  const [brandId, setBrandId] = useState<string>('all');
  const [days, setDays] = useState(30);
  const [refreshing, setRefreshing] = useState(false);

  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [byPillar, setByPillar] = useState<PillarReportRow[]>([]);
  const [byHour, setByHour] = useState<HourReportRow[]>([]);
  const [topPerformers, setTopPerformers] = useState<TopPerformerRow[]>([]);
  const [signals, setSignals] = useState<SocialSignal[]>([]);
  const [hashtags, setHashtags] = useState<HashtagTopRow[]>([]);
  const [boostTarget, setBoostTarget] = useState<{ contentId: string; signalId?: string } | null>(null);

  const params = brandId === 'all' ? { days } : { days, brand_id: brandId };

  const load = async () => {
    try {
      const [s, p, h, t, sig, hh] = await Promise.all([
        socialApi.reports.summary(params),
        socialApi.reports.byPillar(params),
        socialApi.reports.byHour(params),
        socialApi.reports.topPerformers({ ...params, limit: 8 }),
        socialApi.signals.list(true),
        socialApi.hashtags.top({ ...params, limit: 12 }),
      ]);
      setSummary(s);
      setByPillar(p);
      setByHour(h);
      setTopPerformers(t);
      setSignals(sig);
      setHashtags(hh);
    } catch {
      /* silent */
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, days]);

  const refresh = async () => {
    setRefreshing(true);
    try {
      await socialApi.reports.refresh();
      await socialApi.signals.detect();
      await load();
    } finally {
      setRefreshing(false);
    }
  };

  const ackSignal = async (id: string) => {
    await socialApi.signals.acknowledge(id);
    setSignals((s) => s.filter((x) => x.id !== id));
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
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold leading-tight">Relatórios Social</h1>
            <p className="text-xs text-muted-foreground">
              Performance dos posts publicados via Instagram Graph API
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {brands.length > 1 && (
            <select
              value={brandId}
              onChange={(e) => setBrandId(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="all">Todas as marcas</option>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
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
          <Button
            size="sm"
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', refreshing && 'animate-spin')} />
            <span className="ml-1">{refreshing ? 'Atualizando…' : 'Atualizar'}</span>
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        {summary && summary.posts_with_metrics === 0 && (
          <div className="mb-4 rounded-lg border border-dashed border-border bg-muted/20 p-6 text-center">
            <BarChart3 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Sem dados ainda. Pra ver métricas, é preciso:
            </p>
            <ol className="ml-4 mt-2 list-decimal space-y-1 text-left text-xs text-foreground/80">
              <li>Conectar Instagram em <Link href="/configuracoes/social" className="text-primary underline">/configuracoes/social</Link></li>
              <li>Publicar pelo menos 1 conteúdo (publica via Graph API ou marca como published manualmente)</li>
              <li>Aguardar o worker (6h) ou clicar &quot;Atualizar&quot; pra forçar puxar métricas</li>
            </ol>
          </div>
        )}

        {/* Signals (alerts) */}
        {signals.length > 0 && (
          <section className="mb-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="h-4 w-4 text-cyan-500" />
                Insights da IA ({signals.length})
              </h2>
              <Link
                href="/configuracoes/alerts"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                📲 Configurar alertas WhatsApp
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {signals.slice(0, 6).map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'flex items-start gap-2 rounded-lg border p-3',
                    s.severity === 'critical'
                      ? 'border-red-500/30 bg-red-500/5'
                      : s.severity === 'warning'
                        ? 'border-amber-500/30 bg-amber-500/5'
                        : 'border-cyan-500/30 bg-cyan-500/5',
                  )}
                >
                  {s.severity === 'critical' || s.severity === 'warning' ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  ) : (
                    <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold">{s.title}</p>
                    {s.description && (
                      <p className="mt-1 text-[11px] text-foreground/70">
                        {s.description}
                      </p>
                    )}
                    {s.delta_pct !== null && (
                      <p className="mt-1 text-[10px] font-mono text-muted-foreground">
                        Δ {s.delta_pct > 0 ? '+' : ''}
                        {s.delta_pct}%
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {s.signal_type === 'hit_post' && s.content_id && (
                      <button
                        type="button"
                        onClick={() =>
                          setBoostTarget({
                            contentId: s.content_id as string,
                            signalId: s.id,
                          })
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-pink-500/40 bg-pink-500/10 px-1.5 py-0.5 text-[10px] font-medium text-pink-700 dark:text-pink-300 hover:bg-pink-500/20"
                      >
                        <Megaphone className="h-3 w-3" />
                        Promover
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => ackSignal(s.id)}
                      className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                      title="Marcar como visto"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {boostTarget && (
          <BoostDialog
            contentId={boostTarget.contentId}
            signalId={boostTarget.signalId}
            onClose={() => setBoostTarget(null)}
          />
        )}

        {/* KPIs principais */}
        {summary && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold">Resumo ({days} dias)</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi icon={Eye} label="Alcance" value={summary.total_reach} />
              <Kpi icon={Heart} label="Curtidas" value={summary.total_likes} />
              <Kpi icon={MessageSquare} label="Comentários" value={summary.total_comments} />
              <Kpi icon={Share2} label="Comparts." value={summary.total_shares} />
              <Kpi icon={Bookmark} label="Salvos" value={summary.total_saved} />
              <Kpi
                icon={TrendingUp}
                label="Engagement"
                value={summary.avg_engagement_rate}
                isPercent
              />
            </div>
          </section>
        )}

        {/* Por pilar + por hora */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Por pilar */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Engagement por pilar</h2>
            {byPillar.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <div className="flex flex-col gap-2">
                {byPillar.map((p) => (
                  <PillarBar key={p.pillar} row={p} max={byPillar[0]?.avg_engagement_rate ?? 1} />
                ))}
              </div>
            )}
          </section>

          {/* Por hora */}
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold">Engagement por horário (BRT)</h2>
            {byHour.length === 0 ? (
              <p className="text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <HourChart rows={byHour} />
            )}
          </section>
        </div>

        {/* Hashtags campeãs */}
        {hashtags.length > 0 && (
          <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold">
              Hashtags campeãs ({hashtags.length})
            </h2>
            <div className="overflow-hidden rounded-lg border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Hashtag</th>
                    <th className="px-3 py-2 text-right">Usos</th>
                    <th className="px-3 py-2 text-right">Engajamento</th>
                    <th className="px-3 py-2 text-right">Alcance médio</th>
                  </tr>
                </thead>
                <tbody>
                  {hashtags.map((h, i) => (
                    <tr
                      key={h.hashtag}
                      className={cn(
                        'border-b border-border/60',
                        i === 0 && 'bg-cyan-500/5',
                      )}
                    >
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-blue-600 dark:text-blue-400">
                          {i === 0 && <span>👑</span>}
                          #{h.hashtag}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        {h.total_uses}×
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs">
                        <span
                          className={cn(
                            h.avg_engagement_rate >= 0.05
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : 'text-foreground/70',
                          )}
                        >
                          {(h.avg_engagement_rate * 100).toFixed(2)}%
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-muted-foreground">
                        {fmtNum(Math.round(h.avg_reach))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              👑 = top performer · clique numa hashtag pra ver posts que usaram (em breve)
            </p>
          </section>
        )}

        {/* Top performers */}
        {topPerformers.length > 0 && (
          <section>
            <h2 className="mb-3 text-sm font-semibold">Top performers</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-4">
              {topPerformers.map((t) => (
                <Link
                  key={t.content_id}
                  href={`/social/conteudo/${t.content_id}`}
                  className="group rounded-lg border border-border bg-card transition-colors hover:border-primary/40"
                >
                  <div className="relative aspect-square w-full overflow-hidden rounded-t-lg bg-muted">
                    {t.cover_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={t.cover_image_url}
                        alt=""
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                    ) : null}
                    <div className="absolute right-2 top-2 rounded-full bg-emerald-500/90 px-2 py-0.5 text-[10px] font-bold text-white">
                      {(t.avg_engagement_rate * 100).toFixed(1)}%
                    </div>
                  </div>
                  <div className="p-2 text-xs">
                    <p className="line-clamp-2 font-medium">
                      {t.title ?? '(sem título)'}
                    </p>
                    <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="inline-flex items-center gap-0.5">
                        <Eye className="h-2.5 w-2.5" />
                        {fmtNum(t.total_reach)}
                      </span>
                      <span className="inline-flex items-center gap-0.5">
                        <Heart className="h-2.5 w-2.5" />
                        {fmtNum(t.total_engagement)}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {void ContentCard}
      </div>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  isPercent,
}: {
  icon: typeof TrendingUp;
  label: string;
  value: number;
  isPercent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="mt-1 text-xl font-semibold leading-none">
        {isPercent ? `${(value * 100).toFixed(2)}%` : fmtNum(value)}
      </p>
    </div>
  );
}

function PillarBar({ row, max }: { row: PillarReportRow; max: number }) {
  const pct = max > 0 ? (row.avg_engagement_rate / max) * 100 : 0;
  return (
    <div>
      <div className="mb-0.5 flex items-center justify-between text-xs">
        <span className="font-medium">
          {socialLabels.pillar[row.pillar as keyof typeof socialLabels.pillar] ??
            row.pillar}
        </span>
        <span className="text-muted-foreground">
          {(row.avg_engagement_rate * 100).toFixed(2)}% · {row.total_posts} posts
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-cyan-400"
          style={{ width: `${Math.max(pct, 4)}%` }}
        />
      </div>
    </div>
  );
}

function HourChart({ rows }: { rows: HourReportRow[] }) {
  const max = Math.max(...rows.map((r) => r.avg_engagement_rate), 0.0001);
  return (
    <div className="flex h-32 items-end gap-1">
      {rows.map((r) => {
        const h = Math.max((r.avg_engagement_rate / max) * 100, 2);
        return (
          <div
            key={r.hour_of_day}
            className="group flex flex-1 flex-col items-center gap-1"
            title={`${r.hour_of_day}h: ${(r.avg_engagement_rate * 100).toFixed(2)}% (${r.posts_count} posts)`}
          >
            <div
              className="w-full rounded-t bg-primary/60 transition-colors group-hover:bg-primary"
              style={{ height: `${h}%` }}
            />
            <span className="text-[9px] text-muted-foreground">
              {r.hour_of_day}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('pt-BR');
}
