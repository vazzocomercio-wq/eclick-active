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
 * Endpoint: GET /{ig_media_id}/insights?metric=... (token via header)
 *
 * Métricas pedidas: núcleo válido pra todo tipo de mídia (reach, likes,
 * comments, shares, saved, total_interactions, views) + best-effort de
 * profile_visits/profile_activity (só existem pra mídia de feed).
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

    // Só métricas válidas pra TODO tipo de mídia (imagem, carrossel e reel).
    // A Graph API rejeita o request INTEIRO com 400 se qualquer métrica for
    // incompatível — a lista antiga misturava métricas de conta
    // (profile_visits/profile_activity) e usava impressions/video_views,
    // deprecadas pela Meta em favor de `views`, então NENHUM insight chegava.
    const metrics = [
      'reach',
      'likes',
      'comments',
      'shares',
      'saved',
      'total_interactions',
      'views',
    ];

    try {
      const data = await this.fetchInsightRows(
        igMediaId,
        metrics,
        decrypted.access_token,
      );
      if (!data) return null;

      // Best-effort: métricas de perfil só existem pra mídia de feed
      // (imagem/carrossel) — em reel a Meta devolve 400, e tudo bem.
      const profileRows =
        (await this.fetchInsightRows(
          igMediaId,
          ['profile_visits', 'profile_activity'],
          decrypted.access_token,
          true,
        )) ?? [];
      data.push(...profileRows);

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
      // `views` substituiu impressions/video_views/plays na Graph API —
      // mantém os nomes antigos aqui pq são as colunas de social_metrics_daily
      const views = get('views');
      const impressions = views;
      const likes = get('likes');
      const comments = get('comments');
      const shares = get('shares');
      const saved = get('saved');
      const profile_visits = get('profile_visits');
      const profile_follows = get('profile_activity'); // proxy
      const video_views = views;
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

  /**
   * Chama /{id}/insights com o token no header Authorization (não na query
   * string, onde vazaria em logs de proxy/APM). Retorna null em falha —
   * silenciosamente quando `quiet` (usado pras métricas opcionais de perfil).
   */
  private async fetchInsightRows(
    igMediaId: string,
    metrics: string[],
    accessToken: string,
    quiet = false,
  ): Promise<InsightsRow[] | null> {
    const url = new URL(`${GRAPH_BASE}/${igMediaId}/insights`);
    url.searchParams.set('metric', metrics.join(','));

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      if (!quiet) {
        const text = await res.text().catch(() => '');
        this.log.warn(
          `IG Insights ${igMediaId} retornou ${res.status}: ${text.slice(0, 200)}`,
        );
      }
      return null;
    }
    const body = (await res.json()) as { data?: InsightsRow[] };
    return body.data ?? [];
  }
}
