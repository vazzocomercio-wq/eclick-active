import { Injectable, Logger } from '@nestjs/common';
import type { NewTrendItem, TrendItemKind, TrendMonitor } from '../trends.types';

/**
 * Conector TikTok (TR-5) — DUAS estratégias, escolhidas por env
 * `TIKTOK_TRENDS_SOURCE` (default 'apify'):
 *
 *  • 'apify'    → provedor terceiro (Apify), actor automation-lab/tiktok-trends-scraper.
 *                 O actor puxa do TikTok Creative Center público. `trendType` é UM
 *                 por run → fazemos 1 run por tipo (hashtag/sound/video por padrão).
 *                 Env: APIFY_TOKEN, APIFY_TIKTOK_ACTOR, APIFY_TIKTOK_TYPES (csv),
 *                 APIFY_TIKTOK_MAXRESULTS, APIFY_TIKTOK_PERIOD, APIFY_TIKTOK_INPUT (override opcional).
 *  • 'research' → TikTok Research API oficial (gated). client_credentials →
 *                 /v2/research/video/query/. Env: TIKTOK_RESEARCH_CLIENT_KEY,
 *                 TIKTOK_RESEARCH_CLIENT_SECRET.
 *
 * Best-effort: sem a credencial da estratégia ativa, retorna [] sem quebrar a
 * coleta (mesmo padrão do YouTube/Google Trends). A trava de FREQUÊNCIA do Apify
 * (pra segurar custo) fica no collector (collectAll), não aqui.
 *
 * ⚠️ Mapeamento do Apify é DEFENSIVO nos nomes de campo (vários aliases) — o `kind`
 * já vem do trendType. Confirmar nomes contra o sample real do actor escolhido.
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
    // actorId na URL usa '~' no lugar de '/'
    const actor = (process.env.APIFY_TIKTOK_ACTOR || 'automation-lab/tiktok-trends-scraper').replace('/', '~');
    const types = (process.env.APIFY_TIKTOK_TYPES || 'hashtag,sound,video')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const maxResults = Number(process.env.APIFY_TIKTOK_MAXRESULTS ?? 10);
    const period = Number(monitor.config?.['period'] ?? process.env.APIFY_TIKTOK_PERIOD ?? 7);
    const country = monitor.region || 'BR';

    // override opcional do input (caso o actor ganhe campos novos)
    let base: Record<string, unknown> = {};
    if (process.env.APIFY_TIKTOK_INPUT) {
      try {
        base = JSON.parse(process.env.APIFY_TIKTOK_INPUT) as Record<string, unknown>;
      } catch {
        this.log.warn('APIFY_TIKTOK_INPUT inválido (JSON) — ignorando');
      }
    }

    // token vai no header Authorization (nunca em query string).
    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;
    const out: NewTrendItem[] = [];

    // 1 run por trendType (o actor só aceita um por vez)
    for (const trendType of types) {
      try {
        const input = { ...base, countryCode: country, period, maxResults, trendType };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(120_000),
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

  /** Mapeamento DEFENSIVO nos campos — `kind` vem do trendType. */
  private mapApifyItem(
    it: Record<string, unknown>,
    monitor: TrendMonitor,
    trendType: string,
  ): NewTrendItem | null {
    const str = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = it[k];
        if (typeof v === 'string' && v.trim()) return v.trim();
      }
      return undefined;
    };
    const num = (...keys: string[]): number | undefined => {
      for (const k of keys) {
        const v = it[k];
        if (typeof v === 'number') return v;
        if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) return Number(v);
      }
      return undefined;
    };

    const kind: TrendItemKind =
      trendType === 'sound' ? 'sound'
        : trendType === 'video' ? 'video'
          : trendType === 'creator' ? 'post'
            : 'hashtag';

    const name = str(
      'hashtagName', 'hashtag', 'name', 'title', 'keyword', 'query',
      'trendName', 'songTitle', 'musicName', 'nickname', 'authorName',
    );
    const externalRaw = str('id', 'hashtagId', 'songId', 'videoId', 'userId', 'url') ?? name;
    if (!externalRaw && !name) return null;

    const views = num('videoViews', 'views', 'viewCount', 'playCount');
    const uses = num('publishedVideoCount', 'publishCnt', 'postCount', 'posts', 'videoCount');
    const rank = num('rank', 'ranking');
    const growth = num('rankDiff', 'trend', 'growth', 'publishCntGrowth');

    // score: rank (menor = melhor) tem prioridade; senão views/usos em log
    const baseVal = views ?? uses ?? 0;
    const score =
      rank && rank > 0
        ? Math.max(1, 100 - Math.min(rank, 99))
        : baseVal > 0
          ? Math.min(100, Math.round(Math.log10(baseVal + 1) * 12))
          : 50;

    const cleanName = (name ?? '').replace(/^#/, '');
    const url =
      str('url', 'shareUrl', 'link') ??
      (kind === 'hashtag' && cleanName ? `https://www.tiktok.com/tag/${encodeURIComponent(cleanName)}` : null);

    return {
      monitor_id: monitor.id,
      source: 'tiktok',
      external_id: `tt:${monitor.region}:${trendType}:${(externalRaw ?? name ?? '').toLowerCase()}`.slice(0, 200),
      kind,
      category: monitor.category,
      title: name ?? externalRaw ?? null,
      description: str('description', 'desc', 'videoDescription') ?? null,
      url,
      thumbnail_url: str('coverUrl', 'cover', 'thumbnail', 'thumbnailUrl', 'avatarThumb') ?? null,
      author_name: str('authorName', 'author', 'nickname') ?? null,
      author_handle: str('authorHandle', 'uniqueId', 'username') ?? null,
      media_type: kind === 'sound' ? 'audio' : kind === 'video' ? 'video' : kind,
      lang: monitor.language,
      region: monitor.region,
      published_at: null,
      metrics: { views, uses, growth_pct: growth },
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
