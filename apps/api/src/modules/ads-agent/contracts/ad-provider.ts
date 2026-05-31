/**
 * Contrato do Provider — a CHAVE da extensibilidade do Ads Performance Agent.
 *
 * O motor (ingest, análise, decisão, aprendizado) SÓ conhece estes tipos.
 * Nunca tipos da Meta/TikTok/ML/etc. Adicionar uma plataforma =
 * escrever uma classe `XxxProvider implements AdProvider` e registrá-la no
 * AdProviderDispatcher. Zero alteração no motor, no schema ou no playbook.
 *
 * Mesmo padrão do ChannelDispatcher do Active (Z-API/Baileys) — lá é
 * "canal de mensagem", aqui é "plataforma de anúncio".
 */

export type Platform =
  | 'meta'
  | 'tiktok'
  | 'mercadolivre'
  | 'shopee'
  | 'x'
  | 'linkedin'
  | 'pinterest'
  | 'google';

export type EntityLevel = 'campaign' | 'adset' | 'ad';

export type EntityStatus = 'active' | 'paused' | 'archived';

export type BudgetType = 'daily' | 'lifetime';

export type DecisionType =
  | 'scale_budget'
  | 'reduce_budget'
  | 'pause'
  | 'activate'
  | 'adjust_bid'
  | 'reallocate';

/** Conta de anúncio normalizada (espelho de active.ads_accounts). */
export interface AdAccount {
  id: string; // ads_accounts.id (uuid interno)
  orgId: string;
  platform: Platform;
  externalAccountId: string; // act_xxx (Meta), advertiser_id (TikTok)...
  credentialRef: string; // active.ad_integrations.id — NUNCA o token cru
  currency: string;
  timezone: string;
}

/** Entidade normalizada — campanha, conjunto ou anúncio. */
export interface NormalizedEntity {
  level: EntityLevel;
  externalId: string;
  /** external_id do pai (adset→campaign, ad→adset). null no nível campaign. */
  parentExternalId: string | null;
  name: string | null;
  /** NORMALIZADO: conversions|traffic|reach|leads|catalog_sales|awareness|engagement... */
  objective: string | null;
  status: EntityStatus;
  budgetCents: number | null;
  budgetType: BudgetType | null;
  raw: Record<string, unknown>;
}

/** Insight diário normalizado — sempre em centavos, nº inteiros/decimais canônicos. */
export interface NormalizedInsight {
  entityExternalId: string;
  level: EntityLevel;
  date: string; // YYYY-MM-DD
  spendCents: number;
  impressions: number;
  clicks: number;
  conversions: number;
  revenueCents: number;
  frequency: number | null;
  reach: number | null;
  raw: Record<string, unknown>;
}

export interface DateRange {
  since: Date;
  until: Date;
}

/** Capacidades — nem toda plataforma suporta tudo. */
export interface ProviderCapabilities {
  canAdjustBudget: boolean;
  canPauseEntity: boolean;
  canAdjustBid: boolean;
  canReallocateAcrossAdsets: boolean;
  hasLeadWebhook: boolean;
  minBudgetChangeStepCents: number;
}

/** Decisão a aplicar (consumida por applyAction — MVP-3). */
export interface ProviderDecision {
  account: AdAccount;
  type: DecisionType;
  entityExternalId: string;
  level: EntityLevel;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

export interface ActionResult {
  ok: boolean;
  message?: string;
  raw?: Record<string, unknown>;
}

/**
 * O contrato. Cada plataforma implementa. O motor depende SÓ disto.
 */
export interface AdProvider {
  readonly platform: Platform;

  /** Sincroniza hierarquia campanha→conjunto→anúncio, já normalizada. */
  syncEntities(account: AdAccount): Promise<NormalizedEntity[]>;

  /** Puxa insights de um período → SEMPRE no formato canônico. */
  fetchInsights(account: AdAccount, range: DateRange): Promise<NormalizedInsight[]>;

  /** Aplica uma decisão aprovada → traduz pro dialeto da plataforma. */
  applyAction(decision: ProviderDecision): Promise<ActionResult>;

  capabilities(): ProviderCapabilities;
}
