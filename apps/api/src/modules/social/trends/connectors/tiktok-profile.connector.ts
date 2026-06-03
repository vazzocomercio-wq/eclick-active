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
 * Mineração por PERFIL no TikTok (Pilar 1 — Inteligência Global) via Apify.
 * Puxa os vídeos recentes de uma lista CURADA de perfis. 1 run p/ todos os
 * perfis. Best-effort: sem token → [].
 *
 * Env: APIFY_TOKEN, APIFY_TIKTOK_PROFILE_ACTOR (default clockworks/tiktok-scraper).
 */
@Injectable()
export class TikTokProfileConnector implements ProfileMiningConnector {
  readonly network: ProfileNetwork = 'tiktok';
  private readonly log = new Logger(TikTokProfileConnector.name);

  isConfigured(): boolean {
    return !!process.env.APIFY_TOKEN;
  }

  async collectProfiles(
    profiles: TrendProfile[],
    opts: ProfileMiningOptions,
  ): Promise<NewTrendItem[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      this.log.warn('APIFY_TOKEN ausente — TikTok profile mining desligado');
      return [];
    }
    const list = profiles.filter((p) => p.network === 'tiktok' && p.handle);
    if (!list.length) return [];

    const actor = (process.env.APIFY_TIKTOK_PROFILE_ACTOR || 'clockworks/tiktok-scraper').replace('/', '~');
    const byHandle = new Map<string, TrendProfile>();
    const handles = list.map((p) => {
      const h = p.handle.replace(/^@/, '').toLowerCase();
      byHandle.set(h, p);
      return h;
    });

    // data mínima dos posts (últimos N dias) no formato YYYY-MM-DD
    const oldest = new Date(Date.now() - opts.newerThanDays * 86400000)
      .toISOString()
      .slice(0, 10);
    const input = {
      profiles: handles,
      resultsPerPage: opts.resultsPerProfile,
      oldestPostDateUnified: oldest,
      shouldDownloadVideos: false,
      shouldDownloadCovers: false,
      shouldDownloadSubtitles: false,
      shouldDownloadSlideshowImages: false,
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
        this.log.warn(`apify tt-profile ${res.status}: ${(await res.text()).slice(0, 200)}`);
        return [];
      }
      const videos = (await res.json()) as Array<Record<string, unknown>>;
      this.log.log(`tt-profile/apify perfis=${list.length} vídeos=${videos.length}`);
      return videos
        .map((v) => this.mapVideo(v, byHandle))
        .filter((x): x is NewTrendItem => x !== null);
    } catch (err) {
      this.log.warn(`apify tt-profile falhou: ${(err as Error).message}`);
      return [];
    }
  }

  private mapVideo(
    v: Record<string, unknown>,
    byHandle: Map<string, TrendProfile>,
  ): NewTrendItem | null {
    const s = (k: string): string | undefined => {
      const val = v[k];
      return typeof val === 'string' && val.trim() ? val.trim() : undefined;
    };
    const n = (k: string): number | undefined => {
      const val = v[k];
      return typeof val === 'number' ? val : undefined;
    };

    const id = s('id');
    if (!id) return null;
    const desc = s('text') ?? null;
    const ts = s('createTimeISO') ?? null;
    const webUrl = s('webVideoUrl') ?? null;

    // authorMeta.name (handle) — objeto aninhado
    const author = v['authorMeta'] as Record<string, unknown> | undefined;
    const authorHandle =
      (typeof author?.['name'] === 'string' ? (author['name'] as string) : undefined) ??
      undefined;
    const authorNick =
      typeof author?.['nickName'] === 'string' ? (author['nickName'] as string) : undefined;
    const profile = authorHandle ? byHandle.get(authorHandle.toLowerCase()) : undefined;

    const views = n('playCount') ?? 0;
    const likes = n('diggCount');
    const comments = n('commentCount');
    const shares = n('shareCount');

    const ageDays = ts ? (Date.now() - new Date(ts).getTime()) / 86400000 : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    const score = Math.min(
      100,
      Math.round((views > 0 ? Math.log10(views + 1) * 14 : 25) + recency * 25),
    );

    const metrics: TrendItemMetrics = {};
    if (views >= 0) metrics.views = views;
    if (likes != null && likes >= 0) metrics.likes = likes;
    if (comments != null && comments >= 0) metrics.comments = comments;
    if (shares != null && shares >= 0) metrics.shares = shares;

    return {
      monitor_id: null,
      source: 'tiktok',
      external_id: `tt:${id}`,
      kind: 'video',
      category: profile?.category ?? null,
      title: (desc ?? `@${authorHandle ?? 'tiktok'}`).slice(0, 140),
      description: desc ? desc.slice(0, 1000) : null,
      url: webUrl ?? (authorHandle ? `https://www.tiktok.com/@${authorHandle}/video/${id}` : null),
      thumbnail_url: s('videoUrl') ?? null,
      author_name: authorNick ?? null,
      author_handle: authorHandle ?? null,
      media_type: 'video',
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
