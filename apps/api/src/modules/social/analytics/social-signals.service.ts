import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { SocialSignalAlerter } from './social-signal-alerter.service';
import type { SocialSignal, SignalType } from './analytics.types';

interface PostMetrics {
  content_id: string;
  brand_id: string | null;
  pillar: string | null;
  title: string | null;
  engagement_rate: number;
  reach: number;
}

const HIT_MULTIPLIER = 3.0; // 3× acima da média = HIT
const FLOP_MULTIPLIER = 0.5; // 50% abaixo = FLOP
const MIN_POSTS_FOR_BASELINE = 5;

/**
 * Detector de signals do Social. Roda após cada métricas-refresh:
 *   1. Calcula baseline (média) de engagement_rate por pilar nos últimos 30 dias
 *   2. Compara cada post com sua baseline:
 *      - 3× ↑ → hit_post (severity=info, "🎯 Post do pilar X bombou")
 *      - 50% ↓ → flop_post (severity=warning, "⚠️ Post do pilar Y abaixo da média")
 *   3. Identifica melhor pilar (best_pillar) — info acumulado
 *   4. Identifica melhor janela de horário (best_time_window)
 *
 * Dedupe via signal.dedupe_key que inclui content_id+date pra não
 * re-emitir todo dia.
 */
@Injectable()
export class SocialSignalsService {
  private readonly log = new Logger(SocialSignalsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly alerter: SocialSignalAlerter,
  ) {}

  async detectAll(orgId: string): Promise<{ created: number }> {
    let created = 0;
    try {
      created += await this.detectHitsAndFlops(orgId);
      created += await this.detectBestPillar(orgId);
      created += await this.detectBestTimeWindow(orgId);
      created += await this.detectDecliningTrend(orgId);
    } catch (err) {
      this.log.warn(`detectAll falhou: ${String(err)}`);
    }
    return { created };
  }

  /**
   * Compara média de engagement_rate dos últimos 7 dias vs 7-14d atrás.
   * Se queda > 20% E ambas janelas têm baseline mínimo, gera signal
   * declining_trend (severity warning, dispara WhatsApp via alerter).
   */
  private async detectDecliningTrend(orgId: string): Promise<number> {
    const today = new Date();
    const day7 = new Date(today.getTime() - 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const day14 = new Date(today.getTime() - 14 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    try {
      const { data } = await this.supabase.adminClient
        .from('social_metrics_daily')
        .select('engagement_rate, date, brand_id')
        .eq('org_id', orgId)
        .gte('date', day14);
      const rows = (data ?? []) as Array<{
        engagement_rate: number;
        date: string;
        brand_id: string | null;
      }>;
      if (rows.length < MIN_POSTS_FOR_BASELINE * 2) return 0;

      const recent = rows.filter((r) => r.date >= day7);
      const baseline = rows.filter((r) => r.date < day7);
      if (
        recent.length < MIN_POSTS_FOR_BASELINE ||
        baseline.length < MIN_POSTS_FOR_BASELINE
      ) {
        return 0;
      }

      const avg = (xs: typeof rows) =>
        xs.reduce((s, x) => s + x.engagement_rate, 0) / xs.length;
      const recentAvg = avg(recent);
      const baselineAvg = avg(baseline);
      if (baselineAvg < 0.005) return 0;

      const delta = (recentAvg - baselineAvg) / baselineAvg;
      if (delta > -0.2) return 0; // não caiu o suficiente

      const todayStr = today.toISOString().slice(0, 10);
      await this.upsertSignal({
        org_id: orgId,
        brand_id: null,
        content_id: null,
        signal_type: 'declining_trend',
        severity: 'warning',
        title: `📉 Engagement em queda nos últimos 7 dias`,
        description: `Média atual ${(recentAvg * 100).toFixed(2)}% vs ${(baselineAvg * 100).toFixed(2)}% na semana anterior. Queda de ${Math.round(Math.abs(delta) * 100)}%.`,
        metric_name: 'engagement_rate',
        metric_value: recentAvg,
        benchmark_value: baselineAvg,
        delta_pct: Math.round(delta * 100),
        dedupe_key: `decline:${todayStr}`,
      });
      return 1;
    } catch (err) {
      this.log.warn(`detectDecliningTrend falhou: ${String(err)}`);
      return 0;
    }
  }

  // ─── Hit / Flop detection ───────────────────────

  private async detectHitsAndFlops(orgId: string): Promise<number> {
    // Pega métricas dos últimos 30 dias com pilar
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);

    const { data } = await this.supabase.adminClient
      .from('social_metrics_daily')
      .select('content_id, brand_id, engagement_rate, reach')
      .eq('org_id', orgId)
      .gte('date', since);

    const rows = (data ?? []) as Array<{
      content_id: string;
      brand_id: string | null;
      engagement_rate: number;
      reach: number;
    }>;
    if (rows.length < MIN_POSTS_FOR_BASELINE) return 0;

    // Junta com pilar do content
    const contentIds = Array.from(new Set(rows.map((r) => r.content_id)));
    const { data: contents } = await this.supabase.adminClient
      .from('social_contents')
      .select('id, pillar, title, brand_id')
      .in('id', contentIds);
    const cMap = new Map<string, { pillar: string | null; title: string | null; brand_id: string | null }>();
    for (const c of (contents ?? []) as Array<{
      id: string;
      pillar: string | null;
      title: string | null;
      brand_id: string | null;
    }>) {
      cMap.set(c.id, c);
    }

    // Agrupa por pilar pra calcular baseline
    const byPillar = new Map<string, number[]>();
    const enriched: PostMetrics[] = [];
    for (const r of rows) {
      const c = cMap.get(r.content_id);
      if (!c?.pillar) continue;
      enriched.push({
        content_id: r.content_id,
        brand_id: c.brand_id,
        pillar: c.pillar,
        title: c.title,
        engagement_rate: r.engagement_rate,
        reach: r.reach,
      });
      const arr = byPillar.get(c.pillar) ?? [];
      arr.push(r.engagement_rate);
      byPillar.set(c.pillar, arr);
    }

    // Calcula média por pilar
    const baselines = new Map<string, number>();
    for (const [pillar, rates] of byPillar.entries()) {
      if (rates.length < MIN_POSTS_FOR_BASELINE) continue;
      const avg = rates.reduce((s, x) => s + x, 0) / rates.length;
      baselines.set(pillar, avg);
    }

    let created = 0;
    const today = new Date().toISOString().slice(0, 10);

    for (const post of enriched) {
      if (!post.pillar) continue;
      const baseline = baselines.get(post.pillar);
      if (!baseline || baseline === 0) continue;

      const ratio = post.engagement_rate / baseline;
      if (ratio >= HIT_MULTIPLIER) {
        await this.upsertSignal({
          org_id: orgId,
          brand_id: post.brand_id,
          content_id: post.content_id,
          signal_type: 'hit_post',
          severity: 'info',
          title: `🎯 Post do pilar ${post.pillar} bombou`,
          description: `"${post.title ?? '(sem título)'}" performando ${ratio.toFixed(1)}× a média do pilar ${post.pillar}`,
          metric_name: 'engagement_rate',
          metric_value: post.engagement_rate,
          benchmark_value: baseline,
          delta_pct: Math.round((ratio - 1) * 100),
          dedupe_key: `hit:${post.content_id}:${today}`,
        });
        created += 1;
      } else if (ratio <= FLOP_MULTIPLIER && baseline > 0.005) {
        await this.upsertSignal({
          org_id: orgId,
          brand_id: post.brand_id,
          content_id: post.content_id,
          signal_type: 'flop_post',
          severity: 'warning',
          title: `⚠️ Post abaixo da média do pilar ${post.pillar}`,
          description: `"${post.title ?? '(sem título)'}" com ${(ratio * 100).toFixed(0)}% da média esperada`,
          metric_name: 'engagement_rate',
          metric_value: post.engagement_rate,
          benchmark_value: baseline,
          delta_pct: Math.round((ratio - 1) * 100),
          dedupe_key: `flop:${post.content_id}:${today}`,
        });
        created += 1;
      }
    }

    return created;
  }

  // ─── Best pillar ────────────────────────────────

  private async detectBestPillar(orgId: string): Promise<number> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_by_pillar',
      { p_org_id: orgId, p_brand_id: null, p_since_days: 30 },
    );
    const rows = (data ?? []) as Array<{
      pillar: string;
      avg_engagement_rate: number;
      total_posts: number;
    }>;
    if (rows.length < 2) return 0;

    const valid = rows.filter((r) => r.total_posts >= MIN_POSTS_FOR_BASELINE);
    if (valid.length < 2) return 0;

    const top = valid[0];
    if (!top || top.avg_engagement_rate <= 0) return 0;
    const avgOthers =
      valid.slice(1).reduce((s, r) => s + r.avg_engagement_rate, 0) /
      (valid.length - 1);
    if (avgOthers === 0) return 0;
    const ratio = top.avg_engagement_rate / avgOthers;
    if (ratio < 1.5) return 0;

    const today = new Date().toISOString().slice(0, 10);
    await this.upsertSignal({
      org_id: orgId,
      brand_id: null,
      content_id: null,
      signal_type: 'best_pillar',
      severity: 'info',
      title: `📈 Pilar ${top.pillar} é o que mais engaja`,
      description: `Posts do pilar ${top.pillar} têm engagement ${ratio.toFixed(1)}× maior que os demais (últimos 30d)`,
      metric_name: 'engagement_rate',
      metric_value: top.avg_engagement_rate,
      benchmark_value: avgOthers,
      delta_pct: Math.round((ratio - 1) * 100),
      dedupe_key: `best_pillar:${top.pillar}:${today}`,
    });
    return 1;
  }

  // ─── Best time window ────────────────────────────

  private async detectBestTimeWindow(orgId: string): Promise<number> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_by_hour',
      { p_org_id: orgId, p_brand_id: null, p_since_days: 30 },
    );
    const rows = (data ?? []) as Array<{
      hour_of_day: number;
      posts_count: number;
      avg_engagement_rate: number;
    }>;
    const valid = rows.filter((r) => r.posts_count >= 2);
    if (valid.length < 4) return 0;

    valid.sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
    const top = valid[0];
    if (!top || top.avg_engagement_rate <= 0) return 0;
    const avg =
      valid.reduce((s, r) => s + r.avg_engagement_rate, 0) / valid.length;
    if (avg === 0 || top.avg_engagement_rate / avg < 1.5) return 0;

    const today = new Date().toISOString().slice(0, 10);
    await this.upsertSignal({
      org_id: orgId,
      brand_id: null,
      content_id: null,
      signal_type: 'best_time_window',
      severity: 'info',
      title: `⏰ Melhor horário: ${String(top.hour_of_day).padStart(2, '0')}h`,
      description: `Posts publicados às ${top.hour_of_day}h têm engagement ${(top.avg_engagement_rate / avg).toFixed(1)}× a média`,
      metric_name: 'engagement_rate',
      metric_value: top.avg_engagement_rate,
      benchmark_value: avg,
      delta_pct: Math.round((top.avg_engagement_rate / avg - 1) * 100),
      dedupe_key: `best_time:${top.hour_of_day}:${today}`,
    });
    return 1;
  }

  // ─── Helpers ──────────────────────────────────

  private async upsertSignal(
    payload: Omit<
      SocialSignal,
      | 'id'
      | 'detected_at'
      | 'acknowledged_at'
      | 'acknowledged_by'
      | 'metadata'
    > & { metadata?: Record<string, unknown> },
  ): Promise<void> {
    const { data, error } = await this.supabase.adminClient
      .from('social_signals')
      .upsert(
        { ...payload, metadata: payload.metadata ?? {} },
        { onConflict: 'org_id,dedupe_key' },
      )
      .select('*')
      .single();
    if (error) {
      this.log.warn(`upsertSignal falhou: ${error.message}`);
      return;
    }
    // Notifica managers via WhatsApp se qualificado (best-effort)
    const fullSignal = data as SocialSignal;
    if (fullSignal) {
      void this.alerter.maybeNotify(fullSignal).catch((err) => {
        this.log.warn(`alerter.maybeNotify falhou: ${String(err)}`);
      });
    }
  }

  // ─── List API ────────────────────────────────

  async list(orgId: string, onlyUnacked = false): Promise<SocialSignal[]> {
    let q = this.supabase.adminClient
      .from('social_signals')
      .select('*')
      .eq('org_id', orgId)
      .order('detected_at', { ascending: false })
      .limit(50);
    if (onlyUnacked) q = q.is('acknowledged_at', null);
    const { data } = await q;
    return (data ?? []) as SocialSignal[];
  }

  async acknowledge(
    orgId: string,
    signalId: string,
    actorId: string | null,
  ): Promise<void> {
    await this.supabase.adminClient
      .from('social_signals')
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: actorId,
      })
      .eq('id', signalId)
      .eq('org_id', orgId);
  }

  // Reference para silenciar warning em build TS
  /* eslint-disable @typescript-eslint/no-unused-vars */
  private _signalTypeRef: SignalType | null = null;
}
