import { Injectable, Logger } from '@nestjs/common';
import type {
  NewTrendItem,
  TrendItemKind,
  TrendItemMetrics,
  TrendMonitor,
} from '../trends.types';

/**
 * Conector TikTok (TR-5) — DUAS estratégias, escolhidas por env
 * `TIKTOK_TRENDS_SOURCE` (default 'apify'):
 *
 *  • 'apify'    → provedor terceiro (Apify), actor automation-lab/tiktok-trends-scraper
 *                 (puxa do TikTok Creative Center público). `trendType` é UM por run
 *                 → 1 run por tipo (hashtag/sound/video por padrão). Token via header.
 *                 Env: APIFY_TOKEN, APIFY_TIKTOK_ACTOR, APIFY_TIKTOK_TYPES (csv),
 *                 APIFY_TIKTOK_MAXRESULTS, APIFY_TIKTOK_PERIOD.
 *  • 'research' → TikTok Research API oficial (gated). client_credentials →
 *                 /v2/research/video/query/. Env: TIKTOK_RESEARCH_CLIENT_KEY,
 *                 TIKTOK_RESEARCH_CLIENT_SECRET.
 *
 * Best-effort: sem credencial, retorna [] sem quebrar a coleta. A trava de
 * frequência do Apify (custo) fica no collector (collectAll).
 *
 * Mapeamento Apify é PRECISO por tipo (id = soundId/videoId/hashtag-name — garante
 * external_id único; o `name` do sound é quase sempre "original sound" e colidiria).
 */

type TikTokSource = 'apify' | 'research';

interface ResearchVideo {
  id: string;
  video_description?: string;
  create_time?: number;
  region_code?: string;
  view_count?: number;
  like_count?: number;
  comment_count?: number;
  share_count?: number;
  hashtag_names?: string[];
  music_id?: string;
  username?: string;
}

@Injectable()
export class TikTokConnector {
  private readonly log = new Logger(TikTokConnector.name);

  private source(): TikTokSource {
    return process.env.TIKTOK_TRENDS_SOURCE === 'research' ? 'research' : 'apify';
  }

  isConfigured(): boolean {
    return this.source() === 'research'
      ? !!(process.env.TIKTOK_RESEARCH_CLIENT_KEY && process.env.TIKTOK_RESEARCH_CLIENT_SECRET)
      : !!process.env.APIFY_TOKEN;
  }

  async collect(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    try {
      return this.source() === 'research'
        ? await this.collectViaResearch(monitor)
        : await this.collectViaApify(monitor);
    } catch (err) {
      this.log.warn(
        `tiktok collect (${this.source()}) falhou (${monitor.category}): ${(err as Error).message}`,
      );
      return [];
    }
  }

  // ── Estratégia A: Apify (provedor terceiro) ───────────────────────────────
  private async collectViaApify(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      this.log.warn('APIFY_TOKEN ausente — TikTok/Apify desligado');
      return [];
    }
    const actor = (process.env.APIFY_TIKTOK_ACTOR || 'automation-lab/tiktok-trends-scraper').replace('/', '~');
    const types = (process.env.APIFY_TIKTOK_TYPES || 'hashtag,sound,video')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const maxResults = Number(process.env.APIFY_TIKTOK_MAXRESULTS ?? 10);
    const period = Number(monitor.config?.['period'] ?? process.env.APIFY_TIKTOK_PERIOD ?? 7);
    const country = monitor.region || 'BR';

    // token no header Authorization (nunca em query string)
    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;
    const out: NewTrendItem[] = [];

    // 1 run por trendType (o actor só aceita um por vez). Timeout alto pq o 1º
    // run pega cold start do actor (>120s acontece).
    for (const trendType of types) {
      try {
        const input = { countryCode: country, period, maxResults, trendType };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) {
          this.log.warn(`apify ${actor} [${trendType}] ${res.status}: ${(await res.text()).slice(0, 200)}`);
          continue;
        }
        const items = (await res.json()) as Array<Record<string, unknown>>;
        this.log.log(`tiktok/apify ${trendType} country=${country} itens=${items.length}`);
        for (const it of items) {
          const mapped = this.mapApifyItem(it, monitor, trendType);
          if (mapped) out.push(mapped);
        }
      } catch (err) {
        this.log.warn(`apify [${trendType}] falhou: ${(err as Error).message}`);
      }
    }
    return out;
  }

  /** Mapeamento PRECISO por trendType (campos reais do actor automation-lab). */
  private mapApifyItem(
    it: Record<string, unknown>,
    monitor: TrendMonitor,
    trendType: string,
  ): NewTrendItem | null {
    const s = (k: string): string | undefined => {
      const v = it[k];
      return typeof v === 'string' && v.trim() ? v.trim() : undefined;
    };
    const n = (k: string): number | undefined => {
      const v = it[k];
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
      return undefined;
    };

    const rank = n('rank');
    const metrics: TrendItemMetrics = {};
    let kind: TrendItemKind;
    let mediaType: string;
    let entityId: string | undefined;
    let title: string | null = null;
    let url: string | null = null;
    let thumbnail: string | null = null;
    let authorName: string | null = null;
    let authorHandle: string | null = null;
    let description: string | null = null;

    if (trendType === 'sound') {
      kind = 'sound';
      mediaType = 'audio';
      entityId = s('soundId');
      const nm = s('name') ?? '';
      const author = s('soundAuthor');
      title = [nm, author].filter(Boolean).join(' — ') || nm || 'sound';
      url = s('linkedVideoUrl') ?? null;
      thumbnail = s('soundCover') ?? null;
      authorName = author ?? null;
      metrics.uses = n('publishedVideoCount');
      metrics.views = n('videoViews');
      metrics.duration_sec = n('duration');
    } else if (trendType === 'video') {
      kind = 'video';
      mediaType = 'video';
      entityId = s('videoId');
      title = (s('name') ?? s('videoDesc') ?? '').slice(0, 200) || null;
      description = s('videoDesc') ?? null;
      url = s('videoUrl') ?? null;
      thumbnail = s('videoCoverUrl') ?? null;
      authorName = s('authorName') ?? null;
      authorHandle = s('authorHandle') ?? null;
      metrics.views = n('playCount');
      metrics.likes = n('likeCountVideo');
      metrics.comments = n('commentCount');
      metrics.shares = n('shareCount');
    } else {
      // hashtag (default)
      kind = 'hashtag';
      mediaType = 'hashtag';
      const nm = s('name') ?? '';
      entityId = nm || undefined;
      title = nm || null;
      const clean = nm.replace(/^#/, '');
      url = clean ? `https://www.tiktok.com/tag/${encodeURIComponent(clean)}` : null;
      metrics.uses = n('publishedVideoCount');
      metrics.views = n('videoViews');
    }

    // external_id = entidade real (única). Fallback p/ rank só pra não colidir.
    const idPart = (entityId ?? title ?? '').toLowerCase().trim();
    if (!idPart && rank == null) return null;
    const external_id = `tt:${monitor.region}:${trendType}:${idPart || `r${rank}`}`.slice(0, 200);

    const views = metrics.views ?? 0;
    const score =
      rank && rank > 0
        ? Math.max(1, 100 - Math.min(rank, 99))
        : views > 0
          ? Math.min(100, Math.round(Math.log10(views + 1) * 12))
          : 50;

    return {
      monitor_id: monitor.id,
      source: 'tiktok',
      external_id,
      kind,
      category: monitor.category,
      title,
      description,
      url,
      thumbnail_url: thumbnail,
      author_name: authorName,
      author_handle: authorHandle,
      media_type: mediaType,
      lang: monitor.language,
      region: monitor.region,
      published_at: null,
      metrics,
      score,
    };
  }

  // ── Estratégia B: TikTok Research API (oficial) ───────────────────────────
  private async collectViaResearch(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    const ck = process.env.TIKTOK_RESEARCH_CLIENT_KEY;
    const cs = process.env.TIKTOK_RESEARCH_CLIENT_SECRET;
    if (!ck || !cs) {
      this.log.warn('TIKTOK_RESEARCH_CLIENT_KEY/SECRET ausentes — TikTok/Research desligado');
      return [];
    }
    const token = await this.researchToken(ck, cs);
    if (!token) return [];

    const hashtags = (monitor.keywords.length ? monitor.keywords : [monitor.category])
      .map((h) => h.replace(/^#/, ''))
      .slice(0, 20);
    const { start, end } = this.last30d();
    const fields =
      'id,video_description,create_time,region_code,share_count,view_count,like_count,comment_count,hashtag_names,music_id,username';
    const body = {
      query: {
        and: [
          { operation: 'IN', field_name: 'region_code', field_values: [monitor.region || 'BR'] },
          { operation: 'IN', field_name: 'hashtag_name', field_values: hashtags },
        ],
      },
      max_count: 50,
      start_date: start,
      end_date: end,
    };
    const res = await fetch(
      `https://open.tiktokapis.com/v2/research/video/query/?fields=${encodeURIComponent(fields)}`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!res.ok) {
      this.log.warn(`tiktok research query ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return [];
    }
    const json = (await res.json()) as { data?: { videos?: ResearchVideo[] } };
    const videos = json.data?.videos ?? [];
    this.log.log(`tiktok/research region=${monitor.region} vídeos=${videos.length}`);
    const maxViews = Math.max(...videos.map((v) => v.view_count ?? 0), 1);
    return videos.map((v) => this.mapResearchVideo(v, monitor, maxViews));
  }

  private async researchToken(clientKey: string, clientSecret: string): Promise<string | null> {
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Cache-Control': 'no-cache',
      },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
      }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json()) as {
      access_token?: string;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      this.log.warn(
        `tiktok research token falhou: ${json.error_description ?? json.error ?? res.status}`,
      );
      return null;
    }
    return json.access_token;
  }

  private mapResearchVideo(
    v: ResearchVideo,
    monitor: TrendMonitor,
    maxViews: number,
  ): NewTrendItem {
    const views = v.view_count ?? 0;
    const viewsNorm = maxViews > 0 ? Math.log10(views + 1) / Math.log10(maxViews + 1) : 0;
    const ageDays = v.create_time ? (Date.now() / 1000 - v.create_time) / 86400 : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    const score = Math.round((0.7 * viewsNorm + 0.3 * recency) * 100);
    const desc = (v.video_description ?? '').slice(0, 500) || null;
    return {
      monitor_id: monitor.id,
      source: 'tiktok',
      external_id: `tt:${v.id}`,
      kind: 'video',
      category: monitor.category,
      title: desc ? desc.slice(0, 120) : `TikTok ${v.id}`,
      description: desc,
      url: v.username
        ? `https://www.tiktok.com/@${v.username}/video/${v.id}`
        : `https://www.tiktok.com/video/${v.id}`,
      thumbnail_url: null,
      author_name: null,
      author_handle: v.username ?? null,
      media_type: 'video',
      lang: monitor.language,
      region: v.region_code ?? monitor.region,
      published_at: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
      metrics: {
        views,
        likes: v.like_count,
        comments: v.comment_count,
        shares: v.share_count,
      },
      score,
    };
  }

  /** Janela dos últimos 30 dias no formato YYYYMMDD (limite da Research API). */
  private last30d(): { start: string; end: string } {
    const fmt = (d: Date): string =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    return { start: fmt(new Date(Date.now() - 30 * 86400000)), end: fmt(new Date()) };
  }
}
