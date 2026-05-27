import { Injectable, Logger } from '@nestjs/common';
import { TrendsService } from './trends.service';
import { YouTubeConnector } from './connectors/youtube.connector';
import { GoogleTrendsConnector } from './connectors/google-trends.connector';
import { TikTokConnector } from './connectors/tiktok.connector';
import { MetaAdsConnector } from './connectors/meta-ads.connector';
import { InstagramConnector } from './connectors/instagram.connector';
import type { NewTrendItem, TrendMonitor } from './trends.types';

export interface CollectResult {
  monitors: number;
  items: number;
  by_source: Record<string, number>;
}

/** Redes com conector implementado (youtube/google_trends/tiktok + meta_ads via Apify). */
const TR1_NETWORKS = new Set(['youtube', 'google_trends', 'tiktok', 'meta_ads', 'instagram']);

/** Redes pagas (Apify) — travadas por frequência no autopilot p/ segurar custo. */
const APIFY_NETWORKS = new Set(['tiktok', 'meta_ads', 'instagram']);

/**
 * Orquestra a coleta de tendências: pra cada monitor ativo, chama o conector
 * da rede, faz upsert dos itens e marca last_collected_at. Idempotente.
 */
@Injectable()
export class TrendsCollectorService {
  private readonly log = new Logger(TrendsCollectorService.name);

  constructor(
    private readonly trends: TrendsService,
    private readonly youtube: YouTubeConnector,
    private readonly googleTrends: GoogleTrendsConnector,
    private readonly tiktok: TikTokConnector,
    private readonly metaAds: MetaAdsConnector,
    private readonly instagram: InstagramConnector,
  ) {}

  async collectMonitor(orgId: string, monitor: TrendMonitor): Promise<number> {
    let items: NewTrendItem[] = [];
    if (monitor.network === 'youtube') {
      items = await this.youtube.collect(monitor);
    } else if (monitor.network === 'google_trends') {
      items = await this.googleTrends.collect(monitor);
    } else if (monitor.network === 'tiktok') {
      items = await this.tiktok.collect(monitor);
    } else if (monitor.network === 'meta_ads') {
      items = await this.metaAds.collect(monitor);
    } else if (monitor.network === 'instagram') {
      items = await this.instagram.collect(monitor);
    } else {
      return 0; // rede sem conector nesta fase
    }
    const n = await this.trends.upsertItems(orgId, items);
    await this.trends.markCollected(orgId, monitor.id);
    this.log.log(`coleta ${monitor.network}/${monitor.category}: ${n} itens`);
    return n;
  }

  async collectAll(orgId: string): Promise<CollectResult> {
    // Trava de custo do Apify: redes pagas (tiktok/meta_ads) não coletam no
    // autopilot se coletadas há menos de TIKTOK_COLLECT_EVERY_DAYS (default 7).
    // Coleta manual (botão) ignora a trava.
    const everyDays = Number(process.env.TIKTOK_COLLECT_EVERY_DAYS ?? 7);
    const now = Date.now();
    const monitors = (await this.trends.listMonitors(orgId)).filter((m) => {
      if (!m.is_active || !TR1_NETWORKS.has(m.network)) return false;
      if (APIFY_NETWORKS.has(m.network) && m.last_collected_at) {
        const ageDays = (now - new Date(m.last_collected_at).getTime()) / 86400000;
        if (ageDays < everyDays) return false;
      }
      return true;
    });
    const by_source: Record<string, number> = {};
    let items = 0;
    for (const m of monitors) {
      try {
        const n = await this.collectMonitor(orgId, m);
        items += n;
        by_source[m.network] = (by_source[m.network] ?? 0) + n;
      } catch (err) {
        this.log.warn(`monitor ${m.id} (${m.network}) falhou: ${(err as Error).message}`);
      }
    }
    return { monitors: monitors.length, items, by_source };
  }
}
