import { Injectable, Logger } from '@nestjs/common';
import { SocialChannelCredentialsService } from '../publishing/social-channel-credentials.service';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface InsightValue {
  value?: number | Record<string, number>;
}

interface InsightsRow {
  name: string;
  values?: InsightValue[];
}

export interface InstagramPostInsights {
  reach: number;
  impressions: number;
  likes: number;
  comments: number;
  shares: number;
  saved: number;
  profile_visits: number;
  profile_follows: number;
  video_views: number;
  total_interactions: number;
  engagement_rate: number;
  raw: Record<string, unknown>;
}

/**
 * Puxa Instagram Insights via Graph API. Usado pelo
 * SocialMetricsWorkerService (cron 6h).
 *
 * Endpoint: GET /{ig_media_id}/insights?metric=...&access_token=...
 *
 * Métricas pedidas (depende do tipo de mídia):
 *   - Post estático: reach, impressions, likes, comments, shares, saved
 *   - Carousel: same + carousel_album_engagement
 *   - Reel: video_views, plays, total_interactions
 *
 * Engagement rate = (likes + comments + shares + saved) / reach.
 *
 * Como Instagram só expõe insights pra Business/Creator accounts e
 * só por 90 dias após publicação, fetchPostInsights retorna null pra
 * posts mais antigos ou sem permissão.
 */
@Injectable()
export class InstagramInsightsService {
  private readonly log = new Logger(InstagramInsightsService.name);

  constructor(private readonly creds: SocialChannelCredentialsService) {}

  async fetchPostInsights(
    orgId: string,
    igMediaId: string,
    brandId?: string | null,
  ): Promise<InstagramPostInsights | null> {
    const decrypted = await this.creds.getDecryptedToken(
      orgId,
      'instagram_business',
      brandId,
    );
    if (!decrypted) return null;

    const metrics = [
      'reach',
      'impressions',
      'likes',
      'comments',
      'shares',
      'saved',
      'profile_visits',
      'profile_activity',
      'video_views',
      'total_interactions',
    ];

    const url = new URL(`${GRAPH_BASE}/${igMediaId}/insights`);
    url.searchParams.set('metric', metrics.join(','));
    url.searchParams.set('access_token', decrypted.access_token);

    try {
      const res = await fetch(url.toString());
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        this.log.warn(
          `IG Insights ${igMediaId} retornou ${res.status}: ${text.slice(0, 200)}`,
        );
        return null;
      }
      const body = (await res.json()) as { data?: InsightsRow[] };
      const data = body.data ?? [];

      const get = (name: string): number => {
        const row = data.find((r) => r.name === name);
        const val = row?.values?.[0]?.value;
        if (typeof val === 'number') return val;
        if (val && typeof val === 'object') {
          // profile_activity vem como objeto {bio_link_clicked, etc.}
          return Object.values(val).reduce<number>((s, v) => s + (v ?? 0), 0);
        }
        return 0;
      };

      const reach = get('reach');
      const impressions = get('impressions');
      const likes = get('likes');
      const comments = get('comments');
      const shares = get('shares');
      const saved = get('saved');
      const profile_visits = get('profile_visits');
      const profile_follows = get('profile_activity'); // proxy
      const video_views = get('video_views');
      const total_interactions = get('total_interactions');
      const engagementSum = likes + comments + shares + saved;
      const engagement_rate = reach > 0 ? engagementSum / reach : 0;

      return {
        reach,
        impressions,
        likes,
        comments,
        shares,
        saved,
        profile_visits,
        profile_follows,
        video_views,
        total_interactions,
        engagement_rate,
        raw: { data, fetched_at: new Date().toISOString() },
      };
    } catch (err) {
      this.log.warn(
        `fetchPostInsights ${igMediaId} falhou: ${String(err)}`,
      );
      return null;
    }
  }
}
