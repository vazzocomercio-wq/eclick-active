import { Injectable, Logger } from '@nestjs/common';

/**
 * Cliente da Google Ads API (v18). Stateless — recebe access_token por
 * chamada, não cacheia. Usa `googleAds:searchStream` com GAQL (Google
 * Ads Query Language) — análogo ao GraphQL do Meta.
 *
 * Refresh automático: Google access_token expira em 1h. Caller
 * (AdIntegrationsService) detecta 401 → marca token_expired e recriação
 * cabe ao próximo OAuth flow.
 *
 * Conversão de unidades:
 *   - cost_micros → spend USD: divide por 1.000.000
 *   - average_cpc_micros → cpc USD: divide por 1.000.000
 *   - cpm vem em micros também
 */

const API_VERSION = 'v18';
const ADS_API_BASE = `https://googleads.googleapis.com/${API_VERSION}`;

export interface GoogleCampaign {
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

export interface GoogleCampaignInsight {
  campaign_external_id: string;
  date: string;
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

export class GoogleApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string | null,
    message: string,
  ) {
    super(message);
    this.name = 'GoogleApiError';
  }

  get isAuthError(): boolean {
    return (
      this.status === 401 ||
      this.errorCode === 'AUTHENTICATION_ERROR' ||
      this.errorCode === 'AUTHORIZATION_ERROR'
    );
  }
}

@Injectable()
export class GoogleConnector {
  private readonly logger = new Logger(GoogleConnector.name);

  // ────────────────────────────────────────────
  // Campaigns
  // ────────────────────────────────────────────

  async fetchCampaigns(accessToken: string, customerId: string): Promise<GoogleCampaign[]> {
    const query = `
      SELECT
        campaign.id,
        campaign.name,
        campaign.status,
        campaign.advertising_channel_type,
        campaign.start_date,
        campaign.end_date,
        campaign_budget.amount_micros,
        campaign_budget.total_amount_micros
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `;

    interface SearchResult {
      results?: Array<{
        campaign?: {
          id?: string;
          name?: string;
          status?: string;
          advertisingChannelType?: string;
          startDate?: string;
          endDate?: string;
        };
        campaignBudget?: {
          amountMicros?: string;
          totalAmountMicros?: string;
        };
      }>;
      nextPageToken?: string;
    }

    const out: GoogleCampaign[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      pages += 1;
      const json: SearchResult = await this.searchPaged(
        accessToken,
        customerId,
        query,
        pageToken,
      );
      for (const r of json.results ?? []) {
        const camp = r.campaign;
        if (!camp?.id) continue;
        out.push({
          external_id: camp.id,
          name: camp.name ?? '(sem nome)',
          status: camp.status ?? 'UNKNOWN',
          objective: camp.advertisingChannelType ?? null,
          daily_budget: r.campaignBudget?.amountMicros
            ? Number(r.campaignBudget.amountMicros) / 1_000_000
            : null,
          lifetime_budget: r.campaignBudget?.totalAmountMicros
            ? Number(r.campaignBudget.totalAmountMicros) / 1_000_000
            : null,
          started_at: camp.startDate ? new Date(camp.startDate) : null,
          ended_at: camp.endDate ? new Date(camp.endDate) : null,
          raw: r as unknown as Record<string, unknown>,
        });
      }
      pageToken = json.nextPageToken;
    } while (pageToken && pages < 10);

    return out;
  }

  // ────────────────────────────────────────────
  // Insights — métricas diárias por campaign
  // ────────────────────────────────────────────

  async fetchInsights(
    accessToken: string,
    customerId: string,
    since: Date,
    until: Date,
  ): Promise<GoogleCampaignInsight[]> {
    const sinceStr = toYmd(since);
    const untilStr = toYmd(until);

    const query = `
      SELECT
        campaign.id,
        segments.date,
        metrics.cost_micros,
        metrics.impressions,
        metrics.clicks,
        metrics.ctr,
        metrics.average_cpc,
        metrics.average_cpm,
        metrics.conversions,
        metrics.conversions_value,
        metrics.cost_per_conversion
      FROM campaign
      WHERE segments.date BETWEEN '${sinceStr}' AND '${untilStr}'
    `;

    interface MetricsResult {
      results?: Array<{
        campaign?: { id?: string };
        segments?: { date?: string };
        metrics?: {
          costMicros?: string;
          impressions?: string;
          clicks?: string;
          ctr?: number;
          averageCpc?: string;
          averageCpm?: string;
          conversions?: number;
          conversionsValue?: number;
          costPerConversion?: string;
        };
      }>;
      nextPageToken?: string;
    }

    const out: GoogleCampaignInsight[] = [];
    let pageToken: string | undefined;
    let pages = 0;

    do {
      pages += 1;
      const json: MetricsResult = await this.searchPaged(
        accessToken,
        customerId,
        query,
        pageToken,
      );
      for (const r of json.results ?? []) {
        if (!r.campaign?.id || !r.segments?.date) continue;
        out.push(this.normalizeInsightRow(r));
      }
      pageToken = json.nextPageToken;
    } while (pageToken && pages < 30);

    return out;
  }

  // ────────────────────────────────────────────
  // Privates
  // ────────────────────────────────────────────

  /**
   * Chama googleAds:search com paging. Devolve a página inteira como JSON.
   */
  private async searchPaged<T>(
    accessToken: string,
    customerId: string,
    query: string,
    pageToken: string | undefined,
  ): Promise<T> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!devToken) {
      throw new GoogleApiError(
        500,
        'CONFIG_MISSING',
        'GOOGLE_ADS_DEVELOPER_TOKEN ausente no servidor.',
      );
    }
    const body = pageToken ? { query, pageToken } : { query };
    const res = await fetch(
      `${ADS_API_BASE}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': devToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) {
      const text = await res.text();
      let errorCode: string | null = null;
      try {
        const parsed = JSON.parse(text) as {
          error?: { details?: Array<{ errors?: Array<{ errorCode?: Record<string, string> }> }> };
        };
        const firstErr = parsed.error?.details?.[0]?.errors?.[0]?.errorCode;
        if (firstErr) errorCode = Object.keys(firstErr)[0] ?? null;
      } catch {
        /* não-JSON */
      }
      throw new GoogleApiError(
        res.status,
        errorCode,
        `Google Ads ${res.status}: ${text.slice(0, 300)}`,
      );
    }
    return (await res.json()) as T;
  }

  private normalizeInsightRow(r: {
    campaign?: { id?: string };
    segments?: { date?: string };
    metrics?: {
      costMicros?: string;
      impressions?: string;
      clicks?: string;
      ctr?: number;
      averageCpc?: string;
      averageCpm?: string;
      conversions?: number;
      conversionsValue?: number;
      costPerConversion?: string;
    };
  }): GoogleCampaignInsight {
    const m = r.metrics ?? {};
    const spend = m.costMicros ? Number(m.costMicros) / 1_000_000 : 0;
    const conversions = m.conversions ?? 0;
    const conversionValue = m.conversionsValue ?? 0;
    const costPerConversion = m.costPerConversion
      ? Number(m.costPerConversion) / 1_000_000
      : conversions > 0
        ? spend / conversions
        : 0;
    const roas = spend > 0 ? conversionValue / spend : 0;

    return {
      campaign_external_id: r.campaign!.id!,
      date: r.segments!.date!,
      spend: round2(spend),
      impressions: Number(m.impressions ?? 0),
      clicks: Number(m.clicks ?? 0),
      ctr: round4(m.ctr ?? 0),
      cpc: m.averageCpc ? round4(Number(m.averageCpc) / 1_000_000) : 0,
      cpm: m.averageCpm ? round4(Number(m.averageCpm) / 1_000_000) : 0,
      conversions: round2(conversions),
      cost_per_conversion: round2(costPerConversion),
      roas: round4(roas),
      raw: r as unknown as Record<string, unknown>,
    };
  }
}

function toYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
