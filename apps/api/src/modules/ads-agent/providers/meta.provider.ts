import { Injectable, Logger } from '@nestjs/common';
import { AdIntegrationsService } from '../../ads/ad-integrations.service';
import { MetaConnector } from '../../ads/connectors/meta.connector';
import { MetaPublishService } from '../../ads/publish/meta-publish.service';
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
    private readonly publisher: MetaPublishService,
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
    entities: NormalizedEntity[],
  ): Promise<NormalizedInsight[]> {
    const token = await this.integrations.getAccessToken(
      account.orgId,
      account.credentialRef,
    );
    const rows = await this.connector.fetchInsightsRich(
      token,
      account.externalAccountId,
      range.since,
      range.until,
    );

    // objetivo (normalizado) por campanha → escolhe a métrica de RESULTADO
    const objByExt = new Map<string, string | null>(
      entities.map((e) => [e.externalId, e.objective]),
    );

    return rows.map((i) => {
      const objective = objByExt.get(i.campaign_external_id) ?? null;
      const { resultCount, revenue } = pickResult(
        objective,
        i.actions,
        i.actionValues,
      );
      return {
        entityExternalId: i.campaign_external_id,
        level: 'campaign' as const,
        date: i.date,
        // connector devolve spend em unidades de moeda → canonizamos em centavos
        spendCents: Math.round(i.spend * 100),
        impressions: i.impressions,
        clicks: i.clicks,
        // conversions = RESULTADO do objetivo (compra, lead, conversa, engajamento...)
        conversions: resultCount,
        // revenue só dos action_values de compra (0 fora de venda)
        revenueCents: Math.round(revenue * 100),
        frequency: i.frequency,
        reach: i.reach,
        raw: i.raw,
      };
    });
  }

  async applyAction(decision: ProviderDecision): Promise<ActionResult> {
    const orgId = decision.account.orgId;
    const integrationId = decision.account.credentialRef;
    const campaignId = decision.entityExternalId;
    try {
      switch (decision.type) {
        case 'pause':
          await this.publisher.setCampaignStatus(orgId, integrationId, campaignId, 'PAUSED');
          return { ok: true, message: 'Campanha pausada', raw: { status: 'PAUSED' } };
        case 'activate':
          await this.publisher.setCampaignStatus(orgId, integrationId, campaignId, 'ACTIVE');
          return { ok: true, message: 'Campanha reativada', raw: { status: 'ACTIVE' } };
        case 'scale_budget':
        case 'reduce_budget':
        case 'reallocate': {
          const before = numOf(decision.before.budget_cents);
          const after = numOf(decision.after.budget_cents);
          if (before == null || after == null || before <= 0) {
            return { ok: false, message: 'Orçamento antes/depois ausente — não dá pra ajustar.' };
          }
          const pct = (after - before) / before;
          const changed = await this.publisher.adjustCampaignBudgetByPct(
            orgId, integrationId, campaignId, pct,
          );
          return { ok: true, message: `Orçamento ajustado ${(pct * 100).toFixed(0)}%`, raw: { changed } };
        }
        default:
          return { ok: false, message: `Tipo "${decision.type}" ainda não aplicável (requer nível adset).` };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`applyAction(${decision.type}) falhou: ${message}`);
      return { ok: false, message };
    }
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

// ────────────────────────────────────────────
// Resultado por objetivo — escolhe QUAL action-type do Meta conta como
// "resultado" da campanha. O motor nunca vê esses nomes; eles morrem aqui.
// ────────────────────────────────────────────

const PURCHASE_TYPES = [
  'purchase',
  'omni_purchase',
  'offsite_conversion.fb_pixel_purchase',
  'onsite_web_purchase',
  'web_in_store_purchase',
];
const LEAD_TYPES = [
  'lead',
  'leadgen_grouped',
  'onsite_conversion.lead_grouped',
  'offsite_conversion.fb_pixel_lead',
];
const MESSAGING_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
  'onsite_conversion.total_messaging_connection',
  'messaging_conversation_started_7d',
];
const ENGAGEMENT_TYPES = ['post_engagement', 'page_engagement'];
const VIDEO_TYPES = ['video_view'];
const LINK_TYPES = ['link_click'];

function sumTypes(map: Record<string, number>, types: string[]): number {
  let s = 0;
  for (const t of types) s += map[t] ?? 0;
  return s;
}

function numOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Devolve { resultCount, revenue } pro objetivo. `revenue` = valor dos
 * action_values de compra (0 fora de venda — ROAS só faz sentido em venda).
 * `resultCount` = nº de resultados do objetivo (compras, leads, conversas,
 * engajamentos, views, cliques). Fallback robusto quando o objetivo é nulo.
 */
function pickResult(
  objective: string | null,
  actions: Record<string, number>,
  actionValues: Record<string, number>,
): { resultCount: number; revenue: number } {
  const revenue = sumTypes(actionValues, PURCHASE_TYPES);
  let resultCount: number;
  switch (objective) {
    case 'conversions':
    case 'catalog_sales': {
      const p = sumTypes(actions, PURCHASE_TYPES);
      resultCount = p > 0 ? p : sumTypes(actions, LEAD_TYPES);
      break;
    }
    case 'leads':
      resultCount = sumTypes(actions, LEAD_TYPES);
      break;
    case 'messages':
      resultCount = sumTypes(actions, MESSAGING_TYPES);
      break;
    case 'engagement':
      resultCount = sumTypes(actions, ENGAGEMENT_TYPES);
      break;
    case 'video_views':
      resultCount = sumTypes(actions, VIDEO_TYPES);
      break;
    case 'traffic':
      resultCount = sumTypes(actions, LINK_TYPES);
      break;
    case 'reach':
    case 'awareness':
      // julga por CPM/alcance/frequência — sem "resultado" de ação
      resultCount = 0;
      break;
    default: {
      // objetivo desconhecido/nulo: melhor sinal disponível, em ordem
      resultCount =
        sumTypes(actions, PURCHASE_TYPES) ||
        sumTypes(actions, LEAD_TYPES) ||
        sumTypes(actions, MESSAGING_TYPES) ||
        sumTypes(actions, ENGAGEMENT_TYPES) ||
        0;
    }
  }
  return { resultCount, revenue };
}
