/**
 * Tipos do Automation Bridge (Onda 4 / A3 — Active side).
 *
 * Endpoints chamados server-to-server pelo motor StoreAutomationEngine
 * do SaaS. Auth via shared secret no header X-Automation-Bridge-Token.
 */

export type AutomationSeverity =
  | 'critical'
  | 'high'
  | 'medium'
  | 'low'
  | 'opportunity';

export type CartSegment =
  | 'abandoned_24h'
  | 'abandoned_48h'
  | 'abandoned_7d';

export type BroadcastSegment =
  | 'todos'
  | 'compradores'
  | 'interessados'
  | 'inativos';

export type ExecutionType =
  | 'whatsapp_notify_lojista'
  | 'cart_recovery_send'
  | 'whatsapp_broadcast';

export type ExecutionStatus = 'pending' | 'sent' | 'failed' | 'skipped';

// ──────────────────────────────────────────────────────────
// Request DTOs (vêm do SaaS)
// ──────────────────────────────────────────────────────────

export interface NotifyLojistaInput {
  organization_id: string;
  message: string;
  severity: AutomationSeverity;
  /** ID da row em public.store_automation_actions (FK lógica). */
  action_id?: string;
  /** URL pra abrir a UI da automação no SaaS. */
  deeplink?: string;
}

export interface NotifyLojistaResult {
  ok: true;
  sent: boolean;
  queued_for_digest: boolean;
  /** ID da row em automation_executions criada. */
  execution_id: string;
}

export interface TriggerCartRecoveryInput {
  organization_id: string;
  cart_ids?: string[];
  segment?: CartSegment;
  /** Override do template default — vai virar texto da mensagem. */
  template_key?: string;
  /** Texto custom (override final) — se vier, ignora template_key. */
  custom_message?: string;
  rate_limit_ms?: number;
  /** Origem da ação no SaaS. */
  action_id?: string;
}

export interface TriggerCartRecoveryResult {
  ok: true;
  dispatched: number;
  skipped: number;
  errors: number;
  /** IDs das rows em automation_executions criadas. */
  execution_ids: string[];
}

export interface SendBroadcastInput {
  organization_id: string;
  /** Texto pronto da mensagem — IA do SaaS já formatou. */
  message: string;
  target_segment: BroadcastSegment;
  include_image?: boolean;
  image_url?: string;
  include_link?: boolean;
  link_url?: string;
  /** social_content.id (FK lógica cross-project, sem constraint física). */
  source_content_id?: string;
  rate_limit_ms?: number;
  /**
   * Permite audiência > 1000. Default false — recusa pra evitar spam
   * acidental e ban do número WhatsApp.
   */
  force_large_audience?: boolean;
}

export interface SendBroadcastResult {
  ok: true;
  dispatched: number;
  skipped: number;
  errors: number;
  audience_size: number;
  execution_ids: string[];
}

// ──────────────────────────────────────────────────────────
// Campaign card (M4) — SaaS Campaign Center cria card+task
// ──────────────────────────────────────────────────────────

/** Input do create-campaign-card.
 *
 *  SaaS Campaign Center IA chama isto quando dispara um deadline alert ou
 *  quando uma recomendação cai em pending_manager_approval. Cria 1 card
 *  no funil + 1 task vinculada pra forçar ação humana. */
export interface CreateCampaignCardInput {
  organization_id:    string;
  pipeline_id:        string;
  stage_id:           string;
  /** Quem vai ficar dono do card e da task (auth.users.id). */
  assigned_to:        string;
  /** Título do card no kanban (ex: "DEAL Dia das Mães — D-2"). */
  title:              string;
  /** Texto da task vinculada (ex: "Revisar 13 candidatos antes do deadline"). */
  task_title:         string;
  /** Prazo da task (ISO 8601) — geralmente o deadline da campanha. */
  due_date?:          string;
  /** Valor estimado da oportunidade (BRL). Opcional. */
  value?:             number;
  /** Tags pro card (ex: ['campaign-center', 'deadline', 'DEAL']). */
  tags?:              string[];
  /** Metadados livres (ml_campaign_id, ml_promotion_type, alert_type, etc). */
  metadata?:          Record<string, unknown>;
  /** Se já existe card pra esse contexto, evita duplicar.
   *  Snapshot de chave lógica — ex: "campaign:<uuid>:deadline_warning". */
  dedup_key?:         string;
}

export interface CreateCampaignCardResult {
  ok:        true;
  /** UUID do deal criado (ou existente se dedup_key bateu). */
  deal_id:   string;
  /** UUID da task criada (ou null se card já existia e task também). */
  task_id:   string | null;
  /** True se deal+task foram criados agora; false se foi reuso. */
  created:   boolean;
}

// ──────────────────────────────────────────────────────────
// Internal — automation_executions row
// ──────────────────────────────────────────────────────────

export interface AutomationExecutionRow {
  id: string;
  org_id: string;
  source_action_id: string | null;
  source_system: string;
  execution_type: ExecutionType;
  severity: AutomationSeverity | null;
  target_ref: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  status: ExecutionStatus;
  error_message: string | null;
  digest_id: string | null;
  created_at: string;
  executed_at: string | null;
}

// ──────────────────────────────────────────────────────────
// Org settings (chaves dentro de organizations.settings JSONB)
// ──────────────────────────────────────────────────────────

/**
 * Shape do que o bridge espera dentro de `organizations.settings`:
 *
 *   automation_bridge: {
 *     owner_contact_id: uuid       // contato (na própria contacts table) que representa o lojista
 *     owner_channel_id?: uuid      // canal WA específico — opcional, senão pega o primeiro ativo
 *     digest_enabled?: boolean     // default true
 *   }
 *
 * Sem migration nova — usamos o JSONB existente.
 */
export interface OrgAutomationBridgeSettings {
  owner_contact_id?: string;
  owner_channel_id?: string;
  digest_enabled?: boolean;
}
