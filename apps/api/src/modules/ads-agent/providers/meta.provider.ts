import { Injectable, Logger } from '@nestjs/common';
import { AdIntegrationsService } from '../../ads/ad-integrations.service';
import { MetaConnector } from '../../ads/connectors/meta.connector';
import type {
  AdAccount,
  AdProvider,
  ActionResult,
  DateRange,
  EntityStatus,
  NormalizedEntity,
  NormalizedInsight,
  ProviderCapabilities,
  ProviderDecision,
} from '../contracts/ad-provider';

/**
 * Adaptador Meta. Traduz o dialeto da Marketing API pro canônico do motor.
 *
 * REUSA o plumbing já existente do módulo `ads`:
 *   - MetaConnector       → cliente Graph v21 (fetchCampaigns/fetchInsights)
 *   - AdIntegrationsService → resolve o access_token cifrado por credentialRef
 *
 * MVP-1 = read-only no nível CAMPAIGN (que é o que o connector expõe hoje).
 * adset/ad e applyAction chegam no MVP-3 (escrita já existe no MetaPublishService
 * do módulo `ads`, será reaproveitada aqui quando ligarmos a ação).
 */
@Injectable()
export class MetaProvider implements AdProvider {
  readonly platform = 'meta' as const;
  private readonly logger = new Logger(MetaProvider.name);

  constructor(
    private readonly integrations: AdIntegrationsService,
    private readonly connector: MetaConnector,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      canAdjustBudget: true,
      canPauseEntity: true,
      canAdjustBid: true,
      canReallocateAcrossAdsets: true,
      hasLeadWebhook: true, // Meta tem webhook de LEADS (não de performance)
      minBudgetChangeStepCents: 100, // R$1/dia piso prático
    };
  }

  async syncEntities(account: AdAccount): Promise<NormalizedEntity[]> {
    const token = await this.integrations.getAccessToken(
      account.orgId,
      account.credentialRef,
    );
    const campaigns = await this.connector.fetchCampaigns(
      token,
      account.externalAccountId,
    );

    return campaigns.map((c) => {
      const budgetCents = c.daily_budget ?? c.lifetime_budget ?? null;
      const budgetType =
        c.daily_budget != null
          ? ('daily' as const)
          : c.lifetime_budget != null
            ? ('lifetime' as const)
            : null;
      return {
        level: 'campaign' as const,
        externalId: c.external_id,
        parentExternalId: null,
        name: c.name,
        objective: normalizeMetaObjective(c.objective),
        status: normalizeMetaStatus(c.status),
        budgetCents, // Meta já devolve budgets em centavos
        budgetType,
        raw: c.raw,
      };
    });
  }

  async fetchInsights(
    account: AdAccount,
    range: DateRange,
  ): Promise<NormalizedInsight[]> {
    const token = await this.integrations.getAccessToken(
      account.orgId,
      account.credentialRef,
    );
    const rows = await this.connector.fetchInsights(
      token,
      account.externalAccountId,
      range.since,
      range.until,
    );

    return rows.map((i) => {
      // connector devolve spend em unidades de moeda (ex.: reais) e roas =
      // valor_conversão / spend. Canonizamos tudo em centavos.
      const spendCents = Math.round(i.spend * 100);
      const revenueCents = Math.round(i.roas * i.spend * 100);
      return {
        entityExternalId: i.campaign_external_id,
        level: 'campaign' as const,
        date: i.date,
        spendCents,
        impressions: i.impressions,
        clicks: i.clicks,
        conversions: i.conversions,
        revenueCents,
        frequency: null, // connector ainda não traz; chega quando subirmos adset/ad
        reach: null,
        raw: i.raw,
      };
    });
  }

  applyAction(decision: ProviderDecision): Promise<ActionResult> {
    // MVP-3: ligar no MetaPublishService (setCampaignStatus / adjustCampaignBudgetByPct).
    this.logger.warn(
      `applyAction(${decision.type}) chamado mas não implementado no MVP-1`,
    );
    return Promise.resolve({
      ok: false,
      message: 'applyAction do Meta chega no MVP-3 (escrita ainda desligada).',
    });
  }
}

// ────────────────────────────────────────────
// Normalização Meta → canônico
// ────────────────────────────────────────────

function normalizeMetaStatus(status: string): EntityStatus {
  switch (status.toUpperCase()) {
    case 'ACTIVE':
      return 'active';
    case 'PAUSED':
    case 'CAMPAIGN_PAUSED':
    case 'ADSET_PAUSED':
      return 'paused';
    case 'ARCHIVED':
    case 'DELETED':
      return 'archived';
    default:
      return 'paused'; // conservador: o que não reconhecemos não conta como ativo
  }
}

/**
 * Mapeia objetivos do Meta (ODAX novos OUTCOME_* + legados) pro canônico.
 * Fallback = lowercase do bruto (não perde informação, só não normaliza).
 */
function normalizeMetaObjective(objective: string | null): string | null {
  if (!objective) return null;
  const o = objective.toUpperCase();
  const map: Record<string, string> = {
    OUTCOME_SALES: 'conversions',
    CONVERSIONS: 'conversions',
    PRODUCT_CATALOG_SALES: 'catalog_sales',
    CATALOG_SALES: 'catalog_sales',
    OUTCOME_LEADS: 'leads',
    LEAD_GENERATION: 'leads',
    OUTCOME_TRAFFIC: 'traffic',
    LINK_CLICKS: 'traffic',
    OUTCOME_AWARENESS: 'awareness',
    BRAND_AWARENESS: 'awareness',
    REACH: 'reach',
    OUTCOME_ENGAGEMENT: 'engagement',
    POST_ENGAGEMENT: 'engagement',
    PAGE_LIKES: 'engagement',
    VIDEO_VIEWS: 'video_views',
    MESSAGES: 'messages',
    OUTCOME_APP_PROMOTION: 'app_promotion',
    APP_INSTALLS: 'app_promotion',
  };
  return map[o] ?? objective.toLowerCase();
}
