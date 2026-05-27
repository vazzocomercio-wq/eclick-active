import { Injectable, Logger } from '@nestjs/common';
import type { NewTrendItem, TrendMonitor } from '../trends.types';

/**
 * Conector Meta Ad Library (TR-2, revivido via Apify) — criativos de anúncios
 * ATIVOS de concorrentes. A API oficial da Meta é gated/EU-only no BR, então
 * usamos o actor apify/facebook-ads-scraper (Ad Library pública, sem login).
 *
 * Input do actor: startUrls (URL de busca da Ad Library) + resultsLimit +
 * isDetailsPerAd + activeStatus. Montamos 1 URL de busca por TERMO (concorrentes
 * + keywords + categoria, máx 3 p/ custo), country = região do monitor.
 *
 * Env: APIFY_TOKEN, APIFY_META_ADS_ACTOR (default apify/facebook-ads-scraper),
 *      APIFY_META_ADS_MAXRESULTS (default 10).
 * Best-effort: sem APIFY_TOKEN → []. Token via header (nunca query string).
 */
@Injectable()
export class MetaAdsConnector {
  private readonly log = new Logger(MetaAdsConnector.name);

  isConfigured(): boolean {
    return !!process.env.APIFY_TOKEN;
  }

  async collect(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    const token = process.env.APIFY_TOKEN;
    if (!token) {
      this.log.warn('APIFY_TOKEN ausente — Meta Ad Library desligado');
      return [];
    }
    const actor = (process.env.APIFY_META_ADS_ACTOR || 'apify/facebook-ads-scraper').replace('/', '~');
    const limit = Number(process.env.APIFY_META_ADS_MAXRESULTS ?? 10);
    const country = monitor.region || 'BR';

    // termos: concorrentes (nome/handle) + keywords + categoria. Máx 3 (1 run cada).
    const terms = [
      ...monitor.competitors.map((c) => c.name || c.handle || ''),
      ...monitor.keywords,
    ];
    const search = (terms.length ? terms : [monitor.category])
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 3);
    if (!search.length) return [];

    const url = `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items`;
    const out: NewTrendItem[] = [];

    for (const term of search) {
      try {
        const adLibUrl =
          `https://www.facebook.com/ads/library/?active_status=active&ad_type=all` +
          `&country=${encodeURIComponent(country)}&q=${encodeURIComponent(term)}` +
          `&search_type=keyword_unordered`;
        const input = {
          startUrls: [{ url: adLibUrl }],
          resultsLimit: limit,
          isDetailsPerAd: true,
          activeStatus: 'active',
        };
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(240_000),
        });
        if (!res.ok) {
          this.log.warn(`apify meta-ads [${term}] ${res.status}: ${(await res.text()).slice(0, 200)}`);
          continue;
        }
        const ads = (await res.json()) as Array<Record<string, unknown>>;
        this.log.log(`meta-ads/apify "${term}" country=${country} ads=${ads.length}`);
        for (const ad of ads) {
          const mapped = this.mapAd(ad, monitor, term);
          if (mapped) out.push(mapped);
        }
      } catch (err) {
        this.log.warn(`apify meta-ads [${term}] falhou: ${(err as Error).message}`);
      }
    }
    return out;
  }

  private mapAd(
    ad: Record<string, unknown>,
    monitor: TrendMonitor,
    term: string,
  ): NewTrendItem | null {
    const snap = (ad['snapshot'] ?? {}) as Record<string, unknown>;
    const S = (o: Record<string, unknown> | undefined, k: string): string | undefined => {
      const v = o?.[k];
      return typeof v === 'string' && v.trim() ? v : undefined;
    };
    const arr0 = (o: Record<string, unknown> | undefined, k: string): Record<string, unknown> | undefined => {
      const v = o?.[k];
      return Array.isArray(v) && v.length ? (v[0] as Record<string, unknown>) : undefined;
    };

    const adId = S(ad, 'adArchiveId') ?? S(ad, 'adArchiveID');
    if (!adId) return null;

    const pageName = S(ad, 'pageName') ?? S(snap, 'pageName') ?? null;
    const card0 = arr0(snap, 'cards');
    const bodyObj = snap['body'] as Record<string, unknown> | undefined;
    const bodyText =
      (bodyObj ? S(bodyObj, 'text') : undefined) ??
      S(card0, 'body') ??
      S(snap, 'linkDescription') ??
      S(card0, 'linkDescription') ??
      S(snap, 'caption') ??
      null;
    const thumb =
      S(card0, 'originalImageUrl') ??
      S(card0, 'resizedImageUrl') ??
      S(arr0(snap, 'images'), 'originalImageUrl') ??
      S(arr0(snap, 'videos'), 'videoPreviewImageUrl') ??
      S(snap, 'pageProfilePictureUrl') ??
      null;
    const cta = S(snap, 'ctaText') ?? S(card0, 'ctaType') ?? null;

    const variations = typeof ad['collationCount'] === 'number' ? (ad['collationCount'] as number) : 1;
    const startIso = S(ad, 'startDateFormatted') ?? null;
    const ageDays = startIso ? (Date.now() - new Date(startIso).getTime()) / 86400000 : 30;
    const recency = Math.max(0, 1 - ageDays / 60);
    const score = Math.min(100, Math.round(40 + Math.log10(variations + 1) * 25 + recency * 25));

    const title = `${pageName ? `${pageName}: ` : ''}${bodyText ?? cta ?? `anúncio (${term})`}`.slice(0, 140);

    return {
      monitor_id: monitor.id,
      source: 'meta_ads',
      external_id: `fb:${adId}`,
      kind: 'ad_creative',
      category: monitor.category,
      title,
      description: bodyText ? bodyText.slice(0, 500) : null,
      url: `https://www.facebook.com/ads/library/?id=${adId}`,
      thumbnail_url: thumb,
      author_name: pageName,
      author_handle: S(snap, 'pageProfileUri') ?? null,
      media_type: 'ad',
      lang: monitor.language,
      region: monitor.region,
      published_at: startIso,
      metrics: { uses: variations },
      score,
    };
  }
}
