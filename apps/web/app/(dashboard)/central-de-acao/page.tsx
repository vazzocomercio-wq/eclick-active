'use client';

import { useTranslations } from 'next-intl';
import {
  Bell,
  CheckSquare,
  DollarSign,
  Flame,
  RefreshCw,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDashboard } from '@/hooks/use-dashboard';
import { ActivityTimeline } from '@/components/central-de-acao/activity-timeline';
import { AttentionList } from '@/components/central-de-acao/attention-list';
import { HotLeadsCard } from '@/components/central-de-acao/hot-leads-card';
import { MetricCard } from '@/components/central-de-acao/metric-card';
import { TopDealsCard } from '@/components/central-de-acao/top-deals-card';
import { SacAttentionCard } from '@/components/central-de-acao/sac-attention-card';
import { SocialAttentionCard } from '@/components/central-de-acao/social-attention-card';

export default function CentralDeAcaoPage() {
  const t = useTranslations('centralAcao.page');
  const { data, loading, error, refetch } = useDashboard();
  const m = data?.metrics;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-accent" />
            <h1 className="text-lg font-semibold">{t('title')}</h1>
          </div>
          <p className="text-xs text-muted-foreground">{t('subtitle')}</p>
        </div>

        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={loading}>
          <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('refresh')}
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 p-6">
          {error && (
            <div className="rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* BLOCO 1 — Métricas (4 cards) */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard
              label={t('metrics.unreadConversations')}
              value={m?.unread_conversations ?? 0}
              urgentThreshold={10}
              icon={Bell}
              iconClassName="bg-blue-500/15 text-blue-400"
              href="/conversas?filter=unread"
              loading={loading && !data}
            />
            <MetricCard
              label={t('metrics.hotLeads')}
              value={m?.hot_leads ?? 0}
              icon={Flame}
              iconClassName="bg-orange-500/15 text-orange-400"
              href="/contatos?temperature=hot"
              loading={loading && !data}
            />
            <MetricCard
              label={t('metrics.pipelineValue')}
              value={m?.pipeline_value ?? 0}
              isCurrency
              icon={DollarSign}
              iconClassName="bg-accent/15 text-accent"
              href="/funis"
              loading={loading && !data}
            />
            <MetricCard
              label={t('metrics.tasksToday')}
              value={m?.pending_tasks_today ?? 0}
              icon={CheckSquare}
              iconClassName="bg-purple-500/15 text-purple-400"
              href="/tarefas"
              loading={loading && !data}
            />
          </section>

          {/* BLOCO 2 — Atenção agora */}
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <header className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="text-sm font-semibold">{t('attentionTitle')}</h2>
              </div>
              {data && data.attention.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {t('topN', { n: data.attention.length })}
                </span>
              )}
            </header>
            <AttentionList items={data?.attention ?? []} loading={loading && !data} />
          </section>

          {/* BLOCOS SAC + Social (lado a lado em telas largas) */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SacAttentionCard />
            <SocialAttentionCard />
          </section>

          {/* BLOCOS 3 & 4 — Hot leads + Top deals */}
          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <HotLeadsCard items={data?.hot_leads ?? []} loading={loading && !data} />
            <TopDealsCard items={data?.top_deals ?? []} loading={loading && !data} />
          </section>

          {/* BLOCO 5 — Atividade recente */}
          <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
            <header className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">{t('recentActivityTitle')}</h2>
            </header>
            <ActivityTimeline items={data?.recent_activity ?? []} loading={loading && !data} />
          </section>
        </div>
      </div>
    </div>
  );
}
