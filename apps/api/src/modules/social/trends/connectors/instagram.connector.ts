import { Injectable, Logger } from '@nestjs/common';
import type { NewTrendItem, TrendItemMetrics, TrendMonitor } from '../trends.types';

/**
 * Conector Instagram hashtags (TR-2b) via Apify (apify/instagram-hashtag-scraper).
 * Puxa posts em alta das hashtags do monitor (keywords) — engajamento real do nicho.
 * O actor aceita VÁRIAS hashtags num run só (1 run = mais barato).
 *
 * Env: APIFY_TOKEN, APIFY_INSTAGRAM_ACTOR (default apify/instagram-hashtag-scraper),
 *      APIFY_INSTAGRAM_MAXRESULTS (default 15). Token via header. Best-effort: sem token → [].
 * ⚠️ likesCount pode vir -1 (oculto) → não conta como métrica.
 */
@Injectable()
export class InstagramConnector {
  private readonly log = new Logger(InstagramConnector.name);

  isConfigured(): boolean {
    return !!process.env.APIFY_TOKEN;
  }

  async collect(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      this.log.warn('APIFY_TOKEN ausente — Instagram desligado');
      return [];
    }
    const actor = (process.env.APIFY_INSTAGRAM_ACTOR || 'apify/instagram-hashtag-scraper').replace('/', '~');
    const maxResults = Number(process.env.APIFY_INSTAGRAM_MAXRESULTS ?? 15);
    const tags = (monitor.keywords.length ? monitor.keywords : [monitor.category])
      .map((t) => t.trim().replace(/^#/, ''))
      .filter(Boolean)
      .slice(0, 5);
    if (!tags.length) return [];

    try {
      const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ hashtags: tags, resultsType: 'posts', resultsLimit: maxResults }),
        signal: AbortSignal.timeout(240_000),
      });
      if (!res.ok) {
        this.log.warn(`apify instagram ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }
      const posts = (await res.json()) as Array<Record<string, unknown>>;
      this.log.log(`instagram/apify tags=${tags.join(',')} posts=${posts.length}`);
      return posts.map((p) => this.mapPost(p, monitor)).filter((x): x is NewTrendItem => x !== null);
    } catch (err) {
      this.log.warn(`apify instagram falhou: ${(err as Error).message}`);
      return [];
    }
  }

  private mapPost(p: Record<string, unknown>, monitor: TrendMonitor): NewTrendItem | null {
    const s = (k: string): string | undefined => {
      const v = p[k];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const n = (k: string): number | undefined => {
      const v = p[k];
      return typeof v === 'number' ? v : undefined;
    };

    const id = s('id') ?? s('shortCode');
    if (!id) return null;
    const shortCode = s('shortCode');
    const caption = s('caption') ?? null;
    const likes = n('likesCount');
    const comments = n('commentsCount');
    const type = s('type'); // Image | Video | Sidecar
    const ts = s('timestamp') ?? null;

    const eng = (likes && likes > 0 ? likes : 0) + (comments && comments > 0 ? comments : 0);
    const ageDays = ts ? (Date.now() - new Date(ts).getTime()) / 86400000 : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    const score = Math.min(
      100,
      Math.round((eng > 0 ? Math.log10(eng + 1) * 18 : 30) + recency * 25),
    );

    const metrics: TrendItemMetrics = {};
    if (likes != null && likes >= 0) metrics.likes = likes;
    if (comments != null && comments >= 0) metrics.comments = comments;

    return {
      monitor_id: monitor.id,
      source: 'instagram',
      external_id: `ig:${id}`,
      kind: 'post',
      category: monitor.category,
      title: (caption ?? `@${s('ownerUsername') ?? 'post'}`).slice(0, 140),
      description: caption ? caption.slice(0, 500) : null,
      url: s('url') ?? (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null),
      thumbnail_url: s('displayUrl') ?? null,
      author_name: s('ownerFullName') ?? null,
      author_handle: s('ownerUsername') ?? null,
      media_type: type === 'Video' ? 'video' : type === 'Sidecar' ? 'carousel' : 'image',
      lang: monitor.language,
      region: monitor.region,
      published_at: ts,
      metrics,
      score,
    };
  }
}
