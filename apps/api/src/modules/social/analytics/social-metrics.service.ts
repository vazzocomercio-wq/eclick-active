import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { InstagramInsightsService } from './instagram-insights.service';
import type {
  SocialMetricsDaily,
  ReportSummary,
  PillarReportRow,
  HourReportRow,
  TopPerformerRow,
} from './analytics.types';

interface PostToFetch {
  id: string;
  org_id: string;
  brand_id: string | null;
  external_post_ids: Record<string, unknown>;
  published_at: string;
}

@Injectable()
export class SocialMetricsService {
  private readonly log = new Logger(SocialMetricsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly instagramInsights: InstagramInsightsService,
  ) {}

  /**
   * Busca posts publicados nos últimos N dias e refaz fetch das
   * métricas de cada um. Idempotente — UPSERT em (content_id, channel, date).
   */
  async refreshAllRecent(
    orgId: string | null,
    sinceDays = 30,
    limit = 200,
  ): Promise<{ refreshed: number; failed: number }> {
    let q = this.supabase.adminClient
      .from('social_contents')
      .select('id, org_id, brand_id, external_post_ids, published_at')
      .eq('status', 'published')
      .gte(
        'published_at',
        new Date(Date.now() - sinceDays * 86_400_000).toISOString(),
      )
      .order('published_at', { ascending: false })
      .limit(limit);

    if (orgId) q = q.eq('org_id', orgId);

    const { data } = await q;
    const posts = (data ?? []) as PostToFetch[];
    let refreshed = 0;
    let failed = 0;

    for (const post of posts) {
      try {
        const externalIds = post.external_post_ids ?? {};
        const igPostId =
          (externalIds.instagram_business as string | undefined) ??
          (externalIds.instagram_post as string | undefined);
        if (!igPostId) continue;

        const insights = await this.instagramInsights.fetchPostInsights(
          post.org_id,
          igPostId,
          post.brand_id,
        );
        if (!insights) {
          failed += 1;
          continue;
        }

        const today = new Date().toISOString().slice(0, 10);
        await this.supabase.adminClient
          .from('social_metrics_daily')
          .upsert(
            {
              org_id: post.org_id,
              content_id: post.id,
              brand_id: post.brand_id,
              channel: 'instagram_business',
              external_post_id: igPostId,
              date: today,
              reach: insights.reach,
              impressions: insights.impressions,
              likes: insights.likes,
              comments: insights.comments,
              shares: insights.shares,
              saved: insights.saved,
              profile_visits: insights.profile_visits,
              profile_follows: insights.profile_follows,
              video_views: insights.video_views,
              total_interactions: insights.total_interactions,
              engagement_rate: Number(insights.engagement_rate.toFixed(4)),
              raw_metrics: insights.raw,
              fetched_at: new Date().toISOString(),
            },
            { onConflict: 'content_id,channel,date' },
          );

        refreshed += 1;
      } catch (err) {
        this.log.warn(`refresh ${post.id} falhou: ${String(err)}`);
        failed += 1;
      }
    }

    if (refreshed + failed > 0) {
      this.log.log(
        `metrics refresh: ${refreshed} ok, ${failed} falha (org=${orgId ?? 'all'})`,
      );
    }
    return { refreshed, failed };
  }

  // ─── Reports (consultas RPC) ──────────────────

  async getSummary(
    orgId: string,
    sinceDays = 30,
    brandId?: string,
  ): Promise<ReportSummary> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_summary',
      {
        p_org_id: orgId,
        p_brand_id: brandId ?? null,
        p_since_days: sinceDays,
      },
    );
    const empty: ReportSummary = {
      posts_with_metrics: 0,
      total_reach: 0,
      total_impressions: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      total_saved: 0,
      total_profile_visits: 0,
      total_profile_follows: 0,
      avg_engagement_rate: 0,
    };
    return ((data as ReportSummary | null) ?? empty);
  }

  async getByPillar(
    orgId: string,
    sinceDays = 30,
    brandId?: string,
  ): Promise<PillarReportRow[]> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_by_pillar',
      {
        p_org_id: orgId,
        p_brand_id: brandId ?? null,
        p_since_days: sinceDays,
      },
    );
    return (data ?? []) as PillarReportRow[];
  }

  async getByHour(
    orgId: string,
    sinceDays = 30,
    brandId?: string,
  ): Promise<HourReportRow[]> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_by_hour',
      {
        p_org_id: orgId,
        p_brand_id: brandId ?? null,
        p_since_days: sinceDays,
      },
    );
    return (data ?? []) as HourReportRow[];
  }

  async getTopPerformers(
    orgId: string,
    sinceDays = 30,
    brandId?: string,
    limit = 10,
  ): Promise<TopPerformerRow[]> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_report_top_performers',
      {
        p_org_id: orgId,
        p_brand_id: brandId ?? null,
        p_since_days: sinceDays,
        p_limit: limit,
      },
    );
    return (data ?? []) as TopPerformerRow[];
  }

  async getMetricsForContent(
    orgId: string,
    contentId: string,
  ): Promise<SocialMetricsDaily[]> {
    const { data } = await this.supabase.adminClient
      .from('social_metrics_daily')
      .select('*')
      .eq('org_id', orgId)
      .eq('content_id', contentId)
      .order('date', { ascending: true });
    return (data ?? []) as SocialMetricsDaily[];
  }
}
