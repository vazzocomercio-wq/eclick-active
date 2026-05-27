import { Injectable, Logger } from '@nestjs/common';
import type { NewTrendItem, TrendMonitor } from '../trends.types';

interface YtSearchItem {
  id?: { videoId?: string };
}
interface YtVideo {
  id: string;
  snippet?: {
    title?: string;
    description?: string;
    channelTitle?: string;
    publishedAt?: string;
    defaultAudioLanguage?: string;
    thumbnails?: { medium?: { url?: string }; high?: { url?: string }; default?: { url?: string } };
  };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  contentDetails?: { duration?: string };
}

/**
 * Conector YouTube Data API v3 (TR-1). Busca os vídeos mais vistos da
 * categoria/keywords do monitor nos últimos 30 dias e devolve trend_items
 * com métricas individuais (views/likes/comments/duração).
 *
 * Cota: search.list = 100 unidades, videos.list = ~3 → ~103/monitor.
 * Com 10k/dia dá pra ~90 coletas/dia (sobra pra vários monitores).
 * Key: YOUTUBE_API_KEY (Railway active-api).
 */
@Injectable()
export class YouTubeConnector {
  private readonly log = new Logger(YouTubeConnector.name);
  private readonly API = 'https://www.googleapis.com/youtube/v3';

  isConfigured(): boolean {
    return !!process.env.YOUTUBE_API_KEY;
  }

  async collect(monitor: TrendMonitor, max = 25): Promise<NewTrendItem[]> {
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) {
      this.log.warn('YOUTUBE_API_KEY ausente — conector YouTube desligado');
      return [];
    }
    const q = (monitor.keywords.length ? monitor.keywords.join(' ') : monitor.category).trim();
    if (!q) return [];

    try {
      // 1) search.list — busca resiliente. Mantém SEMPRE regionCode + relevanceLanguage
      //    (não dropar → evita casar com palavra inglesa tipo "lustre"). Varia só
      //    ordem/recência. Com proxy BR (YOUTUBE_PROXY_URL) a 1ª já traz resultados certos.
      const publishedAfter = new Date(Date.now() - 90 * 86400000).toISOString();
      const base: Record<string, string> = {
        part: 'snippet',
        type: 'video',
        maxResults: String(Math.min(max, 50)),
        regionCode: monitor.region || 'BR',
        relevanceLanguage: monitor.language || 'pt',
        q,
        key,
      };
      const attempts: Array<{ label: string; params: Record<string, string> }> = [
        { label: 'recent+relevance', params: { order: 'relevance', publishedAfter } },
        { label: 'recent+views', params: { order: 'viewCount', publishedAfter } },
        { label: 'alltime+relevance', params: { order: 'relevance' } },
      ];

      let ids: string[] = [];
      let used = '';
      for (const att of attempts) {
        if (ids.length) break;
        const params = new URLSearchParams({ ...base, ...att.params });
        const sRes = await this.ytFetch('search', params);
        if (!sRes.ok) {
          this.log.warn(`youtube search [${att.label}] ${sRes.status}: ${(await sRes.text()).slice(0, 200)}`);
          continue;
        }
        const sJson = (await sRes.json().catch(() => ({}))) as { items?: YtSearchItem[] };
        ids = (sJson.items ?? [])
          .map((i) => i.id?.videoId)
          .filter((x): x is string => !!x);
        if (ids.length) used = att.label;
      }
      this.log.log(
        `youtube q="${q}" proxy=${process.env.YOUTUBE_PROXY_URL ? 'on' : 'off'} ids=${ids.length} via=${used || 'none'}`,
      );
      if (!ids.length) return [];

      // 2) videos.list — estatísticas + duração
      const vParams = new URLSearchParams({
        part: 'snippet,statistics,contentDetails',
        id: ids.join(','),
        key,
      });
      const vRes = await this.ytFetch('videos', vParams);
      if (!vRes.ok) {
        this.log.warn(`youtube videos ${vRes.status}`);
        return [];
      }
      const vJson = (await vRes.json()) as { items?: YtVideo[] };
      const vids = vJson.items ?? [];
      const maxViews = Math.max(...vids.map((v) => Number(v.statistics?.viewCount ?? 0)), 1);

      return vids.map((v) => this.toItem(v, monitor, maxViews));
    } catch (err) {
      this.log.warn(`youtube collect falhou (${monitor.category}): ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * Chama a YouTube API direto OU via proxy BR (egress no Brasil) — controlado por
   * YOUTUBE_PROXY_URL + YOUTUBE_PROXY_KEY. A `search` do YouTube usa o IP do caller
   * pra decidir resultados; do nosso servidor (US) ela retorna lixo pra buscas BR.
   * O proxy (função numa região do Brasil) recebe { path, query } e devolve o JSON
   * do YouTube verbatim — assim a busca enxerga o Brasil de verdade.
   */
  private async ytFetch(path: string, params: URLSearchParams): Promise<Response> {
    const proxyUrl = process.env.YOUTUBE_PROXY_URL;
    const proxyKey = process.env.YOUTUBE_PROXY_KEY;
    if (proxyUrl && proxyKey) {
      return fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Proxy-Key': proxyKey },
        body: JSON.stringify({ path, query: params.toString() }),
        signal: AbortSignal.timeout(25_000),
      });
    }
    return fetch(`${this.API}/${path}?${params.toString()}`, {
      signal: AbortSignal.timeout(20_000),
    });
  }

  private toItem(v: YtVideo, monitor: TrendMonitor, maxViews: number): NewTrendItem {
    const sn = v.snippet ?? {};
    const st = v.statistics ?? {};
    const views = Number(st.viewCount ?? 0);
    const likes = Number(st.likeCount ?? 0);
    const comments = Number(st.commentCount ?? 0);
    const durationSec = this.parseDuration(v.contentDetails?.duration);
    const publishedAt = sn.publishedAt ?? null;

    // score: 0.7 views relativo (log) + 0.3 recência (30d)
    const viewsNorm = maxViews > 0 ? Math.log10(views + 1) / Math.log10(maxViews + 1) : 0;
    const ageDays = publishedAt
      ? (Date.now() - new Date(publishedAt).getTime()) / 86400000
      : 30;
    const recency = Math.max(0, 1 - ageDays / 30);
    const score = Math.round((0.7 * viewsNorm + 0.3 * recency) * 100);

    return {
      monitor_id: monitor.id,
      source: 'youtube',
      external_id: v.id,
      kind: durationSec > 0 && durationSec <= 60 ? 'short' : 'video',
      category: monitor.category,
      title: sn.title ?? null,
      description: (sn.description ?? '').slice(0, 500) || null,
      url: `https://www.youtube.com/watch?v=${v.id}`,
      thumbnail_url: sn.thumbnails?.medium?.url ?? sn.thumbnails?.high?.url ?? sn.thumbnails?.default?.url ?? null,
      author_name: sn.channelTitle ?? null,
      author_handle: null,
      media_type: 'video',
      lang: sn.defaultAudioLanguage ?? monitor.language ?? null,
      region: monitor.region,
      published_at: publishedAt,
      metrics: { views, likes, comments, duration_sec: durationSec },
      score,
    };
  }

  /** ISO 8601 (PT#H#M#S) → segundos. */
  private parseDuration(iso?: string): number {
    if (!iso) return 0;
    const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso);
    if (!m) return 0;
    const h = Number(m[1] ?? 0);
    const min = Number(m[2] ?? 0);
    const s = Number(m[3] ?? 0);
    return h * 3600 + min * 60 + s;
  }
}
