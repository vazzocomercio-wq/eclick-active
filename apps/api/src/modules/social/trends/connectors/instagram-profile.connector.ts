import { Injectable, Logger } from '@nestjs/common';
import type {
  NewTrendItem,
  ProfileMiningConnector,
  ProfileMiningOptions,
  ProfileNetwork,
  TrendItemMetrics,
  TrendProfile,
} from '../trends.types';

/**
 * Mineração por PERFIL no Instagram (Pilar 1 — Inteligência Global) via Apify.
 * Diferente do InstagramConnector (hashtag), aqui puxamos os posts RECENTES de
 * uma lista CURADA de perfis de referência — exatamente o passo da Aula 29:
 * `username: [urls]`, `onlyPostsNewerThan`, `resultsLimit`, `skipPinnedPosts`.
 *
 * 1 run do actor para TODOS os perfis (mais barato). Best-effort: sem token → [].
 * Env: APIFY_TOKEN, APIFY_INSTAGRAM_PROFILE_ACTOR (default apify/instagram-scraper).
 */
@Injectable()
export class InstagramProfileConnector implements ProfileMiningConnector {
  readonly network: ProfileNetwork = 'instagram';
  private readonly log = new Logger(InstagramProfileConnector.name);

  isConfigured(): boolean {
    return !!process.env.APIFY_TOKEN;
  }

  async collectProfiles(
    profiles: TrendProfile[],
    opts: ProfileMiningOptions,
  ): Promise<NewTrendItem[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      this.log.warn('APIFY_TOKEN ausente — IG profile mining desligado');
      return [];
    }
    const list = profiles.filter((p) => p.network === 'instagram' && p.handle);
    if (!list.length) return [];

    const actor = (process.env.APIFY_INSTAGRAM_PROFILE_ACTOR || 'apify/instagram-scraper').replace('/', '~');
    const byHandle = new Map<string, TrendProfile>();
    const directUrls = list.map((p) => {
      const h = p.handle.replace(/^@/, '').toLowerCase();
      byHandle.set(h, p);
      return p.url && p.url.includes('instagram.com')
        ? p.url
        : `https://www.instagram.com/${h}/`;
    });

    const input = {
      directUrls,
      resultsType: 'posts',
      resultsLimit: opts.resultsPerProfile,
      onlyPostsNewerThan: `${opts.newerThanDays} days`,
      skipPinnedPosts: true,
      addParentData: false,
    };

    try {
      const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(280_000),
      });
      if (!res.ok) {
        this.log.warn(`apify ig-profile ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }
      const posts = (await res.json()) as Array<Record<string, unknown>>;
      this.log.log(`ig-profile/apify perfis=${list.length} posts=${posts.length}`);
      return posts
        .map((p) => this.mapPost(p, byHandle))
        .filter((x): x is NewTrendItem => x !== null);
    } catch (err) {
      this.log.warn(`apify ig-profile falhou: ${(err as Error).message}`);
      return [];
    }
  }

  private mapPost(
    p: Record<string, unknown>,
    byHandle: Map<string, TrendProfile>,
  ): NewTrendItem | null {
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
    const views = n('videoViewCount') ?? n('videoPlayCount');
    const type = s('type'); // Image | Video | Sidecar
    const productType = s('productType'); // clips = reel
    const ts = s('timestamp') ?? null;
    const ownerHandle = (s('ownerUsername') ?? '').toLowerCase();
    const profile = byHandle.get(ownerHandle);

    const eng =
      (likes && likes > 0 ? likes : 0) +
      (comments && comments > 0 ? comments : 0) +
      (views && views > 0 ? views * 0.1 : 0);
    const ageDays = ts ? (Date.now() - new Date(ts).getTime()) / 86400000 : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    const score = Math.min(
      100,
      Math.round((eng > 0 ? Math.log10(eng + 1) * 18 : 25) + recency * 25),
    );

    const metrics: TrendItemMetrics = {};
    if (likes != null && likes >= 0) metrics.likes = likes;
    if (comments != null && comments >= 0) metrics.comments = comments;
    if (views != null && views >= 0) metrics.views = views;

    const mediaType =
      productType === 'clips' || type === 'Video'
        ? 'video'
        : type === 'Sidecar'
          ? 'carousel'
          : 'image';

    return {
      monitor_id: null,
      source: 'instagram',
      external_id: `ig:${id}`,
      kind: 'post',
      category: profile?.category ?? null,
      title: (caption ?? `@${s('ownerUsername') ?? 'post'}`).slice(0, 140),
      description: caption ? caption.slice(0, 1000) : null,
      url: s('url') ?? (shortCode ? `https://www.instagram.com/p/${shortCode}/` : null),
      thumbnail_url: s('displayUrl') ?? null,
      author_name: s('ownerFullName') ?? null,
      author_handle: s('ownerUsername') ?? null,
      media_type: mediaType,
      lang: null,
      region: profile?.country ?? null,
      published_at: ts,
      metrics,
      score,
      origin: 'profile',
      profile_id: profile?.id ?? null,
    };
  }
}
