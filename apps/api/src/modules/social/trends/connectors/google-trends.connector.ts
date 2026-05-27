import { Injectable, Logger } from '@nestjs/common';
import type { NewTrendItem, TrendMonitor } from '../trends.types';

interface ExploreWidget {
  id?: string;
  token?: string;
  request?: unknown;
}
interface RankedKeyword {
  query?: string;
  value?: number;
  formattedValue?: string;
}

/**
 * Conector Google Trends (TR-1) — SEM chave oficial (Google não tem API pública).
 * Usa o endpoint não-oficial explore→widgetdata pra pegar as buscas em ASCENSÃO
 * (rising related queries) por keyword/categoria. É best-effort: Google pode
 * bloquear IPs de datacenter (429/403) → nesse caso retorna [] sem quebrar a coleta.
 */
@Injectable()
export class GoogleTrendsConnector {
  private readonly log = new Logger(GoogleTrendsConnector.name);
  private readonly BASE = 'https://trends.google.com/trends/api';
  private readonly UA =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

  async collect(monitor: TrendMonitor): Promise<NewTrendItem[]> {
    const terms = monitor.keywords.length ? monitor.keywords : [monitor.category];
    const out: NewTrendItem[] = [];
    const seen = new Set<string>();
    for (const term of terms.slice(0, 5)) {
      try {
        const rising = await this.risingQueries(term, monitor.region, monitor.language);
        for (const rk of rising) {
          const query = (rk.query ?? '').trim();
          if (!query || seen.has(query.toLowerCase())) continue;
          seen.add(query.toLowerCase());
          out.push(this.toItem(query, rk, monitor));
        }
      } catch (err) {
        this.log.warn(`google-trends "${term}" falhou: ${(err as Error).message}`);
      }
    }
    return out;
  }

  private async risingQueries(
    keyword: string,
    geo: string,
    lang: string,
  ): Promise<RankedKeyword[]> {
    const hl = lang === 'pt' ? 'pt-BR' : lang;
    // 1) explore → pega o widget RELATED_QUERIES (token + request)
    const exploreReq = {
      comparisonItem: [{ keyword, geo, time: 'today 3-m' }],
      category: 0,
      property: '',
    };
    const exploreUrl =
      `${this.BASE}/explore?hl=${encodeURIComponent(hl)}&tz=180&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
    const eRes = await fetch(exploreUrl, {
      headers: { 'User-Agent': this.UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!eRes.ok) throw new Error(`explore ${eRes.status}`);
    const eParsed = this.stripPrefix(await eRes.text()) as { widgets?: ExploreWidget[] };
    const widget = (eParsed.widgets ?? []).find((w) => w.id === 'RELATED_QUERIES');
    if (!widget?.token || !widget.request) return [];

    // 2) widgetdata/relatedsearches → rankedList[1] = RISING
    const wUrl =
      `${this.BASE}/widgetdata/relatedsearches?hl=${encodeURIComponent(hl)}&tz=180` +
      `&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
    const wRes = await fetch(wUrl, {
      headers: { 'User-Agent': this.UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!wRes.ok) throw new Error(`widgetdata ${wRes.status}`);
    const wParsed = this.stripPrefix(await wRes.text()) as {
      default?: { rankedList?: Array<{ rankedKeyword?: RankedKeyword[] }> };
    };
    const lists = wParsed.default?.rankedList ?? [];
    const rising = lists[1]?.rankedKeyword ?? lists[0]?.rankedKeyword ?? [];
    return rising.slice(0, 15);
  }

  private toItem(query: string, rk: RankedKeyword, monitor: TrendMonitor): NewTrendItem {
    const isBreakout = (rk.formattedValue ?? '').toLowerCase().includes('breakout');
    const rawValue = isBreakout ? 5000 : Number(rk.value ?? 0);
    const score = isBreakout ? 100 : Math.min(Math.round(rawValue), 100);
    return {
      monitor_id: monitor.id,
      source: 'google_trends',
      external_id: `gt:${monitor.region}:${query.toLowerCase()}`,
      kind: 'search_term',
      category: monitor.category,
      title: query,
      description: null,
      url: `https://trends.google.com/trends/explore?q=${encodeURIComponent(query)}&geo=${monitor.region}`,
      thumbnail_url: null,
      author_name: null,
      author_handle: null,
      media_type: 'text',
      lang: monitor.language,
      region: monitor.region,
      published_at: null,
      metrics: { growth_pct: rawValue },
      score,
    };
  }

  /** Respostas do Trends vêm com prefixo anti-JSON-hijack `)]}',\n`. */
  private stripPrefix(text: string): unknown {
    const idx = text.indexOf('{');
    if (idx < 0) throw new Error('resposta sem JSON');
    return JSON.parse(text.slice(idx));
  }
}
