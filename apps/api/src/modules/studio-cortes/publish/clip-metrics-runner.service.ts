import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { InstagramInsightsService } from '../../social/analytics/instagram-insights.service';
import { SocialChannelCredentialsService } from '../../social/publishing/social-channel-credentials.service';
import { CortesDriveClient } from '../cortes-drive.client';
import { CortesYouTubeService } from './cortes-youtube.service';
import type { ClipPost } from '../studio-cortes.types';

export interface ClipMetrics {
  views: number;
  likes: number;
  comments: number;
  shares: number;
  fetched_at: string;
}

/**
 * Coleta métricas dos cortes publicados (por plataforma) e grava em
 * clip_posts.metrics (jsonb). Instagram reusa o InstagramInsightsService;
 * YouTube usa a Data API (videos.list, ~1 unidade); TikTok é best-effort
 * (depende do escopo video.list, que pode não estar concedido).
 */
@Injectable()
export class ClipMetricsRunnerService {
  private readonly log = new Logger(ClipMetricsRunnerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly igInsights: InstagramInsightsService,
    private readonly creds: SocialChannelCredentialsService,
    private readonly drive: CortesDriveClient,
    private readonly youtube: CortesYouTubeService,
  ) {}

  /** Atualiza métricas de todos os cortes publicados da org (últimos N dias). */
  async refreshForOrg(orgId: string, sinceDays = 30): Promise<{ updated: number }> {
    const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
    const { data } = await this.supabase.adminClient
      .from('clip_posts')
      .select('*')
      .eq('org_id', orgId)
      .eq('status', 'publicado')
      .not('external_post_id', 'is', null)
      .gte('published_at', since)
      .limit(500);
    const posts = (data ?? []) as ClipPost[];

    let updated = 0;
    for (const post of posts) {
      try {
        const metrics = await this.fetchMetrics(orgId, post);
        if (metrics) {
          await this.supabase.adminClient
            .from('clip_posts')
            .update({ metrics })
            .eq('id', post.id)
            .eq('org_id', orgId);
          updated += 1;
        }
      } catch (err) {
        this.log.warn(`[metrics] post ${post.id} falhou: ${String(err)}`);
      }
    }
    return { updated };
  }

  private async fetchMetrics(orgId: string, post: ClipPost): Promise<ClipMetrics | null> {
    if (!post.external_post_id) return null;
    if (post.platform === 'instagram') {
      const ins = await this.igInsights.fetchPostInsights(orgId, post.external_post_id);
      if (!ins) return null;
      return {
        views: ins.video_views || ins.reach || 0,
        likes: ins.likes || 0,
        comments: ins.comments || 0,
        shares: ins.shares || 0,
        fetched_at: new Date().toISOString(),
      };
    }
    if (post.platform === 'youtube') {
      return this.youtubeStats(orgId, post.external_post_id, post.account_id);
    }
    if (post.platform === 'tiktok') {
      return this.tiktokStats(orgId, post.external_post_id);
    }
    return null;
  }

  private async youtubeStats(
    orgId: string,
    videoId: string,
    channelCredId: string | null,
  ): Promise<ClipMetrics | null> {
    try {
      const token = channelCredId
        ? await this.youtube.getValidAccessToken(orgId, channelCredId)
        : await this.drive.getAccessTokenForOrg(orgId);
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as {
        items?: Array<{ statistics?: Record<string, string> }>;
      };
      const s = json.items?.[0]?.statistics;
      if (!s) return null;
      return {
        views: Number(s.viewCount ?? 0),
        likes: Number(s.likeCount ?? 0),
        comments: Number(s.commentCount ?? 0),
        shares: 0,
        fetched_at: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }

  private async tiktokStats(orgId: string, videoId: string): Promise<ClipMetrics | null> {
    try {
      const decrypted = await this.creds.getDecryptedToken(orgId, 'tiktok_business');
      if (!decrypted) return null;
      const res = await fetch(
        'https://open.tiktokapis.com/v2/video/query/?fields=id,view_count,like_count,comment_count,share_count',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${decrypted.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ filters: { video_ids: [videoId] } }),
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!res.ok) return null; // escopo video.list pode não estar concedido — best-effort
      const json = (await res.json()) as {
        data?: { videos?: Array<Record<string, number>> };
      };
      const v = json.data?.videos?.[0];
      if (!v) return null;
      return {
        views: v.view_count ?? 0,
        likes: v.like_count ?? 0,
        comments: v.comment_count ?? 0,
        shares: v.share_count ?? 0,
        fetched_at: new Date().toISOString(),
      };
    } catch {
      return null;
    }
  }
}
