import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente da Marketing API do Meta (Graph API). Stateless — recebe access_token
 * por chamada, não cacheia. Cada método retorna dados normalizados, sem
 * leak da estrutura bruta do Meta (exceto o campo `raw` armazenado no DB).
 *
 * Rate limiting: o Meta limita por user+account; 200 calls/h é o teto comum.
 * Pra MVP fazemos requests sequenciais e tratamos 4XX retornando erro
 * marcado — o worker próximo tick tenta de novo.
 */

const API_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${API_VERSION}`;

export interface MetaCampaign {
  external_id: string;
  name: string;
  status: string;
  objective: string | null;
  daily_budget: number | null;
  lifetime_budget: number | null;
  started_at: Date | null;
  ended_at: Date | null;
  raw: Record<string, unknown>;
}

export interface MetaCampaignInsight {
  campaign_external_id: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  conversions: number;
  cost_per_conversion: number;
  roas: number;
  raw: Record<string, unknown>;
}

/**
 * Insight RICO — além das brutas, traz frequency/reach e o mapa completo de
 * actions/action_values (sem escolher resultado: quem escolhe é o provider,
 * por objetivo). Usado pelo Ads Performance Agent (F12). NÃO mexe no
 * fetchInsights legado (que o AdsSyncService usa).
 */
export interface MetaRichInsight {
  campaign_external_id: string;
  date: string; // YYYY-MM-DD
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpc: number;
  cpm: number;
  frequency: number | null;
  reach: number | null;
  /** action_type → contagem (ex.: purchase, lead, post_engagement, video_view). */
  actions: Record<string, number>;
  /** action_type → valor monetário (action_values). */
  actionValues: Record<string, number>;
  raw: Record<string, unknown>;
}

export class MetaApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly fbCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'MetaApiError';
  }

  /** True se o token expirou / é inválido — chamador deve marcar token_expired. */
  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.fbCode === 190 || // OAuthException — token inválido
      this.fbCode === 102 // Session key invalid
    );
  }
}

@Injectable()
export class MetaConnector {
  private readonly logger = new Logger(MetaConnector.name);

  // ────────────────────────────────────────────
  // Campaigns
  // ────────────────────────────────────────────

  /**
   * Lista campaigns de uma ad account. Paginates automaticamente até esgotar
   * (ou hard cap de 1000 — orgs têm dezenas de campaigns no MVP).
   */
  async fetchCampaigns(accessToken: string, adAccountId: string): Promise<MetaCampaign[]> {
    const fields = [
      'id',
      'name',
      'status',
      'objective',
      'daily_budget',
      'lifetime_budget',
      'start_time',
      'stop_time',
      'created_time',
    ].join(',');

    interface CampaignsPage {
      data: Array<{
        id: string;
        name?: string;
        status?: string;
        objective?: string;
        daily_budget?: string;
        lifetime_budget?: string;
        start_time?: string;
        stop_time?: string;
        created_time?: string;
      }>;
      paging?: { next?: string };
    }

    const out: MetaCampaign[] = [];
    let url: string | null = `${GRAPH_BASE}/${adAccountId}/campaigns?fields=${encodeURIComponent(fields)}&limit=200&access_token=${encodeURIComponent(accessToken)}`;
    let pages = 0;

    while (url && pages < 10) {
      pages += 1;
      const json: CampaignsPage = await this.httpGet<CampaignsPage>(url);

      for (const c of json.data ?? []) {
        out.push({
          external_id: c.id,
          name: c.name ?? '(sem nome)',
          status: c.status ?? 'UNKNOWN',
          objective: c.objective ?? null,
          // Meta retorna budgets em strings de cents
          daily_budget: c.daily_budget ? Number(c.daily_budget) : null,
          lifetime_budget: c.lifetime_budget ? Number(c.lifetime_budget) : null,
          started_at: c.start_time ? new Date(c.start_time) : null,
          ended_at: c.stop_time ? new Date(c.stop_time) : null,
          raw: c as unknown as Record<string, unknown>,
        });
      }
      url = json.paging?.next ?? null;
    }

    return out;
  }

  // ────────────────────────────────────────────
  // Insights — métricas diárias por campaign
  // ────────────────────────────────────────────

  /**
   * Pega insights de TODAS as campaigns da conta entre `since` e `until`,
   * com breakdown diário (`time_increment=1`).
   * Meta retorna 1 row por campaign+date.
   */
  async fetchInsights(
    accessToken: string,
    adAccountId: string,
    since: Date,
    until: Date,
  ): Promise<MetaCampaignInsight[]> {
    const fields = [
      'campaign_id',
      'date_start',
      'date_stop',
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'actions',
      'action_values',
      'cost_per_action_type',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({
        since: toYmd(since),
        until: toYmd(until),
      }),
      limit: '500',
      access_token: accessToken,
    });

    interface InsightsPage {
      data: Array<{
        campaign_id: string;
        date_start: string;
        date_stop: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        ctr?: string;
        cpc?: string;
        cpm?: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
        cost_per_action_type?: Array<{ action_type: string; value: string }>;
      }>;
      paging?: { next?: string };
    }

    const out: MetaCampaignInsight[] = [];
    let url: string | null = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`;
    let pages = 0;

    while (url && pages < 30) {
      pages += 1;
      const json: InsightsPage = await this.httpGet<InsightsPage>(url);

      for (const r of json.data ?? []) {
        out.push(this.normalizeInsightRow(r));
      }
      url = json.paging?.next ?? null;
    }

    return out;
  }

  /**
   * Insights RICOS (F12) — mesma janela/granularidade, mas pede frequency +
   * reach e devolve os mapas de actions/action_values pro provider escolher o
   * resultado por objetivo. Isolado do fetchInsights legado.
   */
  async fetchInsightsRich(
    accessToken: string,
    adAccountId: string,
    since: Date,
    until: Date,
  ): Promise<MetaRichInsight[]> {
    const fields = [
      'campaign_id',
      'date_start',
      'spend',
      'impressions',
      'clicks',
      'ctr',
      'cpc',
      'cpm',
      'frequency',
      'reach',
      'actions',
      'action_values',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      level: 'campaign',
      time_increment: '1',
      time_range: JSON.stringify({ since: toYmd(since), until: toYmd(until) }),
      limit: '500',
      access_token: accessToken,
    });

    interface RichPage {
      data: Array<{
        campaign_id: string;
        date_start: string;
        spend?: string;
        impressions?: string;
        clicks?: string;
        ctr?: string;
        cpc?: string;
        cpm?: string;
        frequency?: string;
        reach?: string;
        actions?: Array<{ action_type: string; value: string }>;
        action_values?: Array<{ action_type: string; value: string }>;
      }>;
      paging?: { next?: string };
    }

    const out: MetaRichInsight[] = [];
    let url: string | null = `${GRAPH_BASE}/${adAccountId}/insights?${params.toString()}`;
    let pages = 0;

    while (url && pages < 30) {
      pages += 1;
      const json: RichPage = await this.httpGet<RichPage>(url);
      for (const r of json.data ?? []) {
        out.push({
          campaign_external_id: r.campaign_id,
          date: r.date_start,
          spend: parseNum(r.spend),
          impressions: parseNum(r.impressions),
          clicks: parseNum(r.clicks),
          ctr: parseNum(r.ctr),
          cpc: parseNum(r.cpc),
          cpm: parseNum(r.cpm),
          frequency: r.frequency != null ? parseNum(r.frequency) : null,
          reach: r.reach != null ? parseNum(r.reach) : null,
          actions: actionsToMap(r.actions),
          actionValues: actionsToMap(r.action_values),
          raw: r as unknown as Record<string, unknown>,
        });
      }
      url = json.paging?.next ?? null;
    }
    return out;
  }

  private normalizeInsightRow(r: {
    campaign_id: string;
    date_start: string;
    spend?: string;
    impressions?: string;
    clicks?: string;
    ctr?: string;
    cpc?: string;
    cpm?: string;
    actions?: Array<{ action_type: string; value: string }>;
    action_values?: Array<{ action_type: string; value: string }>;
    cost_per_action_type?: Array<{ action_type: string; value: string }>;
  }): MetaCampaignInsight {
    const spend = parseNum(r.spend);
    // "Conversions" no Meta vem como soma de várias action_types — pegamos
    // os mais comuns pra leads/sales. Cada org pode ter pixel diferente.
    // Pra MVP, somamos os action_types principais. Configurável depois.
    const conversionTypes = [
      'lead',
      'purchase',
      'complete_registration',
      'onsite_conversion.lead_grouped',
      'offsite_conversion.fb_pixel_lead',
      'offsite_conversion.fb_pixel_purchase',
    ];
    const conversions = sumActions(r.actions, conversionTypes);
    const conversionValue = sumActions(r.action_values, conversionTypes);
    const costPerConversion = conversions > 0 ? spend / conversions : 0;
    const roas = spend > 0 ? conversionValue / spend : 0;

    return {
      campaign_external_id: r.campaign_id,
      date: r.date_start,
      spend,
      impressions: parseNum(r.impressions),
      clicks: parseNum(r.clicks),
      ctr: parseNum(r.ctr),
      cpc: parseNum(r.cpc),
      cpm: parseNum(r.cpm),
      conversions,
      cost_per_conversion: round2(costPerConversion),
      roas: round4(roas),
      raw: r as unknown as Record<string, unknown>,
    };
  }

  // ────────────────────────────────────────────
  // HTTP helper — retorna JSON ou lança MetaApiError
  // ────────────────────────────────────────────

  private async httpGet<T>(url: string): Promise<T> {
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      let fbCode: number | null = null;
      let fbMsg = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as {
          error?: { code?: number; message?: string };
        };
        fbCode = parsed.error?.code ?? null;
        fbMsg = parsed.error?.message ?? fbMsg;
      } catch {
        /* body não é JSON */
      }
      throw new MetaApiError(res.status, fbCode, `Meta ${res.status}: ${fbMsg}`);
    }
    return (await res.json()) as T;
  }
}

// ────────────────────────────────────────────
// Helpers privados ao módulo
// ────────────────────────────────────────────

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseNum(v: string | undefined): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** Converte o array actions/action_values do Meta num mapa action_type→número. */
function actionsToMap(
  actions: Array<{ action_type: string; value: string }> | undefined,
): Record<string, number> {
  const map: Record<string, number> = {};
  if (!actions) return map;
  for (const a of actions) {
    map[a.action_type] = (map[a.action_type] ?? 0) + parseNum(a.value);
  }
  return map;
}

function sumActions(
  actions: Array<{ action_type: string; value: string }> | undefined,
  types: string[],
): number {
  if (!actions) return 0;
  let sum = 0;
  for (const a of actions) {
    if (types.includes(a.action_type)) {
      sum += parseNum(a.value);
    }
  }
  return sum;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
