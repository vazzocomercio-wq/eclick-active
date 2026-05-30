import { BadRequestException, Injectable } from '@nestjs/common';
import { AdIntegrationsService } from '../ad-integrations.service';

const API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${API_VERSION}`;

export type BreakdownDimension = 'placement' | 'age' | 'gender';

export interface BreakdownRow {
  key: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
}

const DIM_MAP: Record<BreakdownDimension, string> = {
  placement: 'publisher_platform',
  age: 'age',
  gender: 'gender',
};

const CONVERSION_ACTIONS = new Set([
  'lead',
  'purchase',
  'complete_registration',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
  'offsite_conversion.fb_pixel_purchase',
]);

/**
 * MetaInsightsService — leitura ON-DEMAND de insights com breakdown
 * (posicionamento/idade/gênero) direto do Graph. Complementa o sync diário
 * (Bloco C, campanha-level) pra responder "ONDE o anúncio performa".
 */
@Injectable()
export class MetaInsightsService {
  constructor(private readonly integrations: AdIntegrationsService) {}

  async fetchBreakdown(
    orgId: string,
    integrationId: string,
    campaignId: string,
    dimension: BreakdownDimension,
    days = 30,
  ): Promise<BreakdownRow[]> {
    const token = await this.integrations.getAccessToken(orgId, integrationId);
    const breakdown = DIM_MAP[dimension];
    const preset = days <= 7 ? 'last_7d' : days <= 14 ? 'last_14d' : days <= 30 ? 'last_30d' : 'last_90d';
    const url =
      `${GRAPH}/${campaignId}/insights` +
      `?fields=spend,impressions,clicks,ctr,actions` +
      `&breakdowns=${breakdown}&level=campaign&date_preset=${preset}&limit=500` +
      `&access_token=${encodeURIComponent(token)}`;

    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      let msg = text.slice(0, 200);
      try {
        const p = JSON.parse(text) as { error?: { message?: string; error_user_msg?: string } };
        msg = p.error?.error_user_msg ?? p.error?.message ?? msg;
      } catch { /* não-JSON */ }
      throw new BadRequestException(`Meta recusou insights (${res.status}): ${msg}`);
    }
    const json = (await res.json()) as {
      data?: Array<Record<string, unknown>>;
    };

    return (json.data ?? []).map((row) => {
      const actions = (row.actions as Array<{ action_type: string; value: string }> | undefined) ?? [];
      const conversions = actions
        .filter((a) => CONVERSION_ACTIONS.has(a.action_type))
        .reduce((s, a) => s + (Number(a.value) || 0), 0);
      return {
        key: String(row[breakdown] ?? '—'),
        spend: Number(row.spend) || 0,
        impressions: Number(row.impressions) || 0,
        clicks: Number(row.clicks) || 0,
        ctr: Number(row.ctr) || 0,
        conversions,
      };
    });
  }
}
