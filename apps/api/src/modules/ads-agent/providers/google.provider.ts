import { Injectable, Logger } from '@nestjs/common';
import { AdIntegrationsService } from '../../ads/ad-integrations.service';
import { GoogleConnector } from '../../ads/connectors/google.connector';
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
 * Adaptador Google Ads — A PROVA da abstração (F12.2). É uma classe nova que
 * implementa AdProvider e se registra no dispatcher; o MOTOR (ingest, dossiê,
 * análise, outcome, KB, fila, modo auto) NÃO muda em nada. Reusa o
 * GoogleConnector (Ads API v18) + AdIntegrationsService já existentes.
 *
 * MVP read-only (sync/insights). applyAction fica stub até existir um
 * GooglePublishService (escrita no Google Ads ≠ Meta). capabilities() reflete isso.
 */
@Injectable()
export class GoogleProvider implements AdProvider {
  readonly platform = 'google' as const;
  private readonly logger = new Logger(GoogleProvider.name);

  constructor(
    private readonly integrations: AdIntegrationsService,
    private readonly connector: GoogleConnector,
  ) {}

  capabilities(): ProviderCapabilities {
    return {
      canAdjustBudget: false, // escrita no Google chega depois (GooglePublishService)
      canPauseEntity: false,
      canAdjustBid: false,
      canReallocateAcrossAdsets: false,
      hasLeadWebhook: false,
      minBudgetChangeStepCents: 100,
    };
  }

  async syncEntities(account: AdAccount): Promise<NormalizedEntity[]> {
    const token = await this.integrations.getAccessToken(account.orgId, account.credentialRef);
    const campaigns = await this.connector.fetchCampaigns(token, account.externalAccountId);

    return campaigns.map((c) => {
      // Google devolve budgets em unidades de moeda (já dividido de micros) → centavos
      const budgetCents =
        c.daily_budget != null
          ? Math.round(c.daily_budget * 100)
          : c.lifetime_budget != null
            ? Math.round(c.lifetime_budget * 100)
            : null;
      const budgetType =
        c.daily_budget != null ? ('daily' as const) : c.lifetime_budget != null ? ('lifetime' as const) : null;
      return {
        level: 'campaign' as const,
        externalId: c.external_id,
        parentExternalId: null,
        name: c.name,
        objective: normalizeGoogleObjective(c.objective),
        status: normalizeGoogleStatus(c.status),
        budgetCents,
        budgetType,
        raw: c.raw,
      };
    });
  }

  async fetchInsights(
    account: AdAccount,
    range: DateRange,
    _entities: NormalizedEntity[],
  ): Promise<NormalizedInsight[]> {
    const token = await this.integrations.getAccessToken(account.orgId, account.credentialRef);
    const rows = await this.connector.fetchInsights(
      token,
      account.externalAccountId,
      range.since,
      range.until,
    );
    return rows.map((i) => ({
      entityExternalId: i.campaign_external_id,
      level: 'campaign' as const,
      date: i.date,
      spendCents: Math.round(i.spend * 100),
      impressions: i.impressions,
      clicks: i.clicks,
      // no Google "conversions" já é o resultado do objetivo; revenue = roas*spend
      conversions: i.conversions,
      revenueCents: Math.round(i.roas * i.spend * 100),
      frequency: null,
      reach: null,
      raw: i.raw,
    }));
  }

  applyAction(decision: ProviderDecision): Promise<ActionResult> {
    this.logger.warn(`applyAction(${decision.type}) — Google ainda é read-only no motor`);
    return Promise.resolve({
      ok: false,
      message: 'Aplicação no Google Ads ainda não implementada (motor read-only pra Google).',
    });
  }
}

// ────────────────────────────────────────────
// Normalização Google → canônico
// ────────────────────────────────────────────

function normalizeGoogleStatus(status: string): EntityStatus {
  switch (status.toUpperCase()) {
    case 'ENABLED':
      return 'active';
    case 'PAUSED':
      return 'paused';
    case 'REMOVED':
      return 'archived';
    default:
      return 'paused';
  }
}

/** advertising_channel_type → objetivo canônico (aproximação). */
function normalizeGoogleObjective(objective: string | null): string | null {
  if (!objective) return null;
  const map: Record<string, string> = {
    SHOPPING: 'catalog_sales',
    PERFORMANCE_MAX: 'conversions',
    SEARCH: 'conversions',
    DISPLAY: 'awareness',
    VIDEO: 'video_views',
    DEMAND_GEN: 'awareness',
    MULTI_CHANNEL: 'conversions',
  };
  return map[objective.toUpperCase()] ?? objective.toLowerCase();
}
