import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AdProviderDispatcher } from './ad-provider.dispatcher';
import { AdsAccountsService } from './ads-accounts.service';
import type {
  AdAccount,
  NormalizedEntity,
  NormalizedInsight,
} from './contracts/ad-provider';

export interface IngestResult {
  account_id: string;
  platform: string;
  entities_upserted: number;
  insights_upserted: number;
  insights_orphaned: number; // insights cuja entity não veio no sync (archived/deleted)
  duration_ms: number;
}

const INSIGHT_BATCH = 500;

/**
 * Motor de ingestão (passos INGEST + SYNC do pipeline). Para uma conta:
 *   1. SYNC    provider.syncEntities()  → upsert active.ads_entities
 *   2. INGEST  provider.fetchInsights() → upsert active.ads_insights
 *
 * Platform-agnostic: resolve o provider pelo dispatcher e nunca toca em
 * detalhes de Meta/TikTok/etc. Best-effort por conta (erro marca a conta,
 * não derruba o ciclo das outras).
 */
@Injectable()
export class AdsIngestService {
  private readonly logger = new Logger(AdsIngestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: AdProviderDispatcher,
    private readonly accounts: AdsAccountsService,
  ) {}

  async ingestAccount(accountId: string, daysBack = 7): Promise<IngestResult> {
    const start = Date.now();
    const row = await this.accounts.getInternal(accountId);
    if (!row) throw new Error(`Conta ${accountId} não encontrada`);
    if (row.status !== 'active') {
      throw new Error(`Conta ${accountId} com status "${row.status}" — pulando`);
    }

    const account = this.accounts.toAdAccount(row);
    const provider = this.dispatcher.resolve(account.platform);

    const result: IngestResult = {
      account_id: accountId,
      platform: account.platform,
      entities_upserted: 0,
      insights_upserted: 0,
      insights_orphaned: 0,
      duration_ms: 0,
    };

    try {
      // 1. SYNC entidades
      const entities = await provider.syncEntities(account);
      const idMap = await this.upsertEntities(account, entities);
      result.entities_upserted = entities.length;

      // 2. INGEST insights (janela últimos N dias)
      const until = new Date();
      const since = new Date(until.getTime() - daysBack * 86400_000);
      const insights = await provider.fetchInsights(account, { since, until });

      const valid = insights.filter((i) => idMap.has(i.entityExternalId));
      result.insights_orphaned = insights.length - valid.length;

      if (valid.length > 0) {
        await this.upsertInsights(account, idMap, valid);
        result.insights_upserted = valid.length;
      }

      await this.accounts.markPolled(accountId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`ingest[${accountId}] falhou: ${message}`);
      await this.accounts.markError(accountId, message);
      throw err;
    }

    result.duration_ms = Date.now() - start;
    this.logger.log(
      `ingest[${accountId}] ${account.platform} entities=${result.entities_upserted} insights=${result.insights_upserted} orphaned=${result.insights_orphaned} took=${result.duration_ms}ms`,
    );
    return result;
  }

  // ────────────────────────────────────────────
  // Persistência
  // ────────────────────────────────────────────

  /**
   * Upsert de entidades. Retorna map external_id → uuid interno.
   * Resolve parent_id num 2º passo (adset→campaign, ad→adset). No MVP-1 só
   * há nível campaign (parentExternalId null), então o 2º passo é no-op.
   */
  private async upsertEntities(
    account: AdAccount,
    entities: NormalizedEntity[],
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (entities.length === 0) return map;

    const rows = entities.map((e) => ({
      org_id: account.orgId,
      account_id: account.id,
      level: e.level,
      platform: account.platform,
      external_id: e.externalId,
      name: e.name,
      objective: e.objective,
      status: e.status,
      budget_cents: e.budgetCents,
      budget_type: e.budgetType,
      raw: e.raw,
      synced_at: new Date().toISOString(),
    }));

    const { data, error } = await this.supabase.adminClient
      .from('ads_entities')
      .upsert(rows, { onConflict: 'account_id,external_id' })
      .select('id, external_id');
    if (error) throw new Error(`upsert ads_entities falhou: ${error.message}`);

    for (const r of (data ?? []) as Array<{ id: string; external_id: string }>) {
      map.set(r.external_id, r.id);
    }

    // 2º passo: liga parent_id pra quem tem pai (adset/ad).
    const withParent = entities.filter((e) => e.parentExternalId);
    for (const e of withParent) {
      const childId = map.get(e.externalId);
      const parentId = e.parentExternalId ? map.get(e.parentExternalId) : null;
      if (childId && parentId) {
        await this.supabase.adminClient
          .from('ads_entities')
          .update({ parent_id: parentId })
          .eq('id', childId);
      }
    }

    return map;
  }

  private async upsertInsights(
    account: AdAccount,
    idMap: Map<string, string>,
    insights: NormalizedInsight[],
  ): Promise<void> {
    const rows = insights.map((i) => ({
      org_id: account.orgId,
      entity_id: idMap.get(i.entityExternalId) as string,
      level: i.level,
      date: i.date,
      spend_cents: i.spendCents,
      impressions: i.impressions,
      clicks: i.clicks,
      conversions: i.conversions,
      revenue_cents: i.revenueCents,
      frequency: i.frequency,
      reach: i.reach,
      raw: i.raw,
    }));

    for (let i = 0; i < rows.length; i += INSIGHT_BATCH) {
      const slice = rows.slice(i, i + INSIGHT_BATCH);
      const { error } = await this.supabase.adminClient
        .from('ads_insights')
        .upsert(slice, { onConflict: 'entity_id,date' });
      if (error) {
        throw new Error(`upsert ads_insights falhou (batch ${i}): ${error.message}`);
      }
    }
  }
}
