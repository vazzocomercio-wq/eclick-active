import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AdIntegrationsService } from './ad-integrations.service';
import {
  MetaApiError,
  MetaCampaign,
  MetaCampaignInsight,
  MetaConnector,
} from './connectors/meta.connector';

export interface SyncResult {
  integration_id: string;
  platform: 'meta' | 'google';
  campaigns_upserted: number;
  metrics_upserted: number;
  /** Campaigns que apareceram no DB mas não vieram do connector (provavelmente
   *  archived/deleted no Meta) — mantemos o registro mas não atualizamos. */
  campaigns_missing: number;
  duration_ms: number;
}

/**
 * Orquestrador de sync. Pra cada integração ativa:
 *   1. Decifra access_token
 *   2. Connector busca campaigns + insights
 *   3. Upsert em ad_campaigns + ad_metrics_daily
 *   4. Atualiza last_sync_at na integration (ou marca error)
 *
 * Tratamento de erro:
 *   - 401/OAuthException → marca status=token_expired
 *   - Outros erros → marca status=error com mensagem (worker próximo
 *     tick tenta de novo)
 *   - Erro NÃO é propagado pro caller (cron worker continua iterando
 *     outras orgs)
 */
@Injectable()
export class AdsSyncService {
  private readonly logger = new Logger(AdsSyncService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly integrations: AdIntegrationsService,
    private readonly meta: MetaConnector,
  ) {}

  // ────────────────────────────────────────────
  // Entry points
  // ────────────────────────────────────────────

  /**
   * Sync incremental — últimos `daysBack` dias (default 7).
   * Chamado pelo cron worker e pelo trigger manual.
   */
  async syncIntegration(integrationId: string, daysBack = 7): Promise<SyncResult> {
    return this.runSync(integrationId, daysBack);
  }

  /**
   * Backfill — usa janela maior (default 90 dias). Chamado uma vez
   * imediatamente após OAuth callback.
   */
  async backfillIntegration(integrationId: string, daysBack = 90): Promise<SyncResult> {
    return this.runSync(integrationId, daysBack);
  }

  /** Lista IDs de integrações que o worker deve processar agora. */
  async listActiveMetaIntegrations(): Promise<string[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ad_integrations')
      .select('id')
      .eq('platform', 'meta')
      .eq('status', 'active');
    if (error) {
      this.logger.error(`listActiveMetaIntegrations falhou: ${error.message}`);
      return [];
    }
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  }

  // ────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────

  private async runSync(integrationId: string, daysBack: number): Promise<SyncResult> {
    const start = Date.now();

    const internal = await this.integrations.getInternal(integrationId);
    if (!internal) {
      throw new Error(`Integração ${integrationId} não encontrada`);
    }
    if (internal.status !== 'active') {
      throw new Error(
        `Integração ${integrationId} com status ${internal.status} — não pode sincronizar`,
      );
    }

    let accessToken: string;
    try {
      accessToken = await this.integrations.getAccessToken(internal.org_id, integrationId);
    } catch (err) {
      // Token expirou/inválido — getAccessToken já marcou status. Aborta.
      this.logger.warn(
        `sync[${integrationId}] cred indisponível: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }

    const result: SyncResult = {
      integration_id: integrationId,
      platform: internal.platform as 'meta' | 'google',
      campaigns_upserted: 0,
      metrics_upserted: 0,
      campaigns_missing: 0,
      duration_ms: 0,
    };

    try {
      if (internal.platform === 'meta') {
        await this.runMetaSync({
          accessToken,
          integrationId,
          orgId: internal.org_id,
          adAccountId: internal.ad_account_id,
          daysBack,
          result,
        });
      } else {
        // Google fica pro Bloco D
        throw new Error('Google sync ainda não implementado (Bloco D)');
      }

      await this.integrations.markSynced(integrationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`sync[${integrationId}] falhou: ${message}`);

      if (err instanceof MetaApiError && err.isAuthError) {
        // Token inválido — marca pra UI pedir re-conexão
        await this.supabase.adminClient
          .from('ad_integrations')
          .update({ status: 'token_expired', error_message: message.slice(0, 500) })
          .eq('id', integrationId);
      } else {
        await this.integrations.markError(integrationId, message);
      }
      throw err;
    }

    result.duration_ms = Date.now() - start;
    this.logger.log(
      `sync[${integrationId}] ok campaigns=${result.campaigns_upserted} metrics=${result.metrics_upserted} took=${result.duration_ms}ms`,
    );
    return result;
  }

  private async runMetaSync(args: {
    accessToken: string;
    integrationId: string;
    orgId: string;
    adAccountId: string;
    daysBack: number;
    result: SyncResult;
  }): Promise<void> {
    // 1. Campaigns (sempre full — é barato, dezenas de rows)
    const campaigns = await this.meta.fetchCampaigns(args.accessToken, args.adAccountId);
    const campaignIdMap = await this.upsertMetaCampaigns({
      orgId: args.orgId,
      integrationId: args.integrationId,
      campaigns,
    });
    args.result.campaigns_upserted = campaigns.length;

    // 2. Insights — janela últimos N dias
    const until = new Date();
    const since = new Date(until.getTime() - args.daysBack * 86400_000);
    const insights = await this.meta.fetchInsights(
      args.accessToken,
      args.adAccountId,
      since,
      until,
    );

    // Filtra insights cuja campaign não está no map (rara — campaign foi
    // deletada entre fetchCampaigns e fetchInsights, ou é archived que
    // o /campaigns endpoint não retorna mas insights ainda dá)
    const validInsights = insights.filter((i) => campaignIdMap.has(i.campaign_external_id));
    args.result.campaigns_missing = insights.length - validInsights.length;

    // 3. Persiste insights
    if (validInsights.length > 0) {
      await this.upsertMetaMetrics({
        orgId: args.orgId,
        integrationId: args.integrationId,
        campaignIdMap,
        insights: validInsights,
      });
      args.result.metrics_upserted = validInsights.length;
    }
  }

  /** Upsert campaigns. Retorna map external_id → uuid interno. */
  private async upsertMetaCampaigns(args: {
    orgId: string;
    integrationId: string;
    campaigns: MetaCampaign[];
  }): Promise<Map<string, string>> {
    if (args.campaigns.length === 0) return new Map();

    const rows = args.campaigns.map((c) => ({
      org_id: args.orgId,
      integration_id: args.integrationId,
      platform: 'meta' as const,
      external_id: c.external_id,
      name: c.name,
      status: c.status,
      objective: c.objective,
      daily_budget: c.daily_budget,
      lifetime_budget: c.lifetime_budget,
      started_at: c.started_at?.toISOString() ?? null,
      ended_at: c.ended_at?.toISOString() ?? null,
      raw: c.raw,
    }));

    const { data, error } = await this.supabase.adminClient
      .from('ad_campaigns')
      .upsert(rows, { onConflict: 'integration_id,external_id' })
      .select('id, external_id');

    if (error) {
      throw new Error(`upsert ad_campaigns falhou: ${error.message}`);
    }

    const map = new Map<string, string>();
    for (const r of (data ?? []) as Array<{ id: string; external_id: string }>) {
      map.set(r.external_id, r.id);
    }
    return map;
  }

  private async upsertMetaMetrics(args: {
    orgId: string;
    integrationId: string;
    campaignIdMap: Map<string, string>;
    insights: MetaCampaignInsight[];
  }): Promise<void> {
    const rows = args.insights.map((m) => ({
      org_id: args.orgId,
      campaign_id: args.campaignIdMap.get(m.campaign_external_id) as string,
      integration_id: args.integrationId,
      platform: 'meta' as const,
      date: m.date,
      spend: m.spend,
      impressions: m.impressions,
      clicks: m.clicks,
      ctr: m.ctr,
      cpc: m.cpc,
      cpm: m.cpm,
      conversions: m.conversions,
      cost_per_conversion: m.cost_per_conversion,
      roas: m.roas,
      raw_metrics: m.raw,
    }));

    // Insere em batches de 500 pra evitar payload monstro com 90 dias × N campaigns
    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error } = await this.supabase.adminClient
        .from('ad_metrics_daily')
        .upsert(slice, { onConflict: 'campaign_id,date' });
      if (error) {
        throw new Error(`upsert ad_metrics_daily falhou (batch ${i}): ${error.message}`);
      }
    }
  }
}
