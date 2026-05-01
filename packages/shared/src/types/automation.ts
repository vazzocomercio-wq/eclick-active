import type { Json, UUID, ISODateString } from './common';
import type {
  AutomationTriggerType,
  AutomationLogStatus,
  ChannelType,
} from '../enums';

// ──────────────────────────────────────────────────────────────
// Trigger config — shape varia por trigger_type
// ──────────────────────────────────────────────────────────────

export interface AutomationTriggerMessageReceived {
  type: 'message_received';
  channel_type?: ChannelType;
  /** Filtra por intenção detectada (ex: 'budget') */
  intent?: string;
  /** Condições adicionais — JSONLogic ou similar */
  conditions?: Json;
}

export interface AutomationTriggerDealStageChanged {
  type: 'deal_stage_changed';
  pipeline_id?: UUID;
  from_stage_id?: UUID;
  to_stage_id?: UUID;
}

export interface AutomationTriggerTimeBased {
  type: 'time_based';
  /** Cron expression (ex: '0 9 * * 1-5') */
  cron: string;
  timezone?: string;
}

export interface AutomationTriggerWebhook {
  type: 'webhook';
  /** Path único gerado: /webhooks/automation/<id>/<token> */
  path: string;
}

export type AutomationTriggerConfig =
  | AutomationTriggerMessageReceived
  | AutomationTriggerDealStageChanged
  | AutomationTriggerTimeBased
  | AutomationTriggerWebhook
  | { type: 'deal_created' | 'contact_created' | 'task_overdue' | 'manual'; conditions?: Json };

// ──────────────────────────────────────────────────────────────
// Action — discriminated union de ações executáveis
// ──────────────────────────────────────────────────────────────

export interface AutomationActionSendMessage {
  type: 'send_message';
  channel_id?: UUID;
  template_id?: UUID;
  /** Texto livre (se não usar template) */
  text?: string;
  /** Substitui {{var}} no texto/template */
  variables?: Record<string, string>;
}

export interface AutomationActionCreateTask {
  type: 'create_task';
  title: string;
  task_type?: string;
  assigned_to?: UUID | 'auto';
  due_in_hours?: number;
}

export interface AutomationActionUpdateDeal {
  type: 'update_deal';
  fields: Partial<{ stage_id: UUID; assigned_to: UUID; tags: string[]; value: number }>;
}

export interface AutomationActionAddTag {
  type: 'add_tag';
  /** 'contact' | 'deal' | 'conversation' */
  target: 'contact' | 'deal' | 'conversation';
  tags: string[];
}

export interface AutomationActionAIClassify {
  type: 'ai_classify';
  /** Salva resultado em qual campo */
  output_field: string;
}

export interface AutomationActionDelay {
  type: 'delay';
  seconds: number;
}

export type AutomationAction =
  | AutomationActionSendMessage
  | AutomationActionCreateTask
  | AutomationActionUpdateDeal
  | AutomationActionAddTag
  | AutomationActionAIClassify
  | AutomationActionDelay;

// ──────────────────────────────────────────────────────────────
// Automation
// ──────────────────────────────────────────────────────────────

/**
 * Automação configurável. Pode ser criada via UI ou via prompt em linguagem natural.
 * Tabela: active.automations
 */
export interface Automation {
  id: UUID;
  org_id: UUID;
  name: string;
  description: string | null;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  /** Array ordenado de ações executadas em sequência */
  actions: AutomationAction[];
  /** Texto original em linguagem natural se a automação foi gerada pela IA */
  natural_language_source: string | null;
  is_active: boolean;
  execution_count: number;
  last_executed_at: ISODateString | null;
  created_by: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Log de cada execução de automação.
 * Tabela: active.automation_logs
 */
export interface AutomationLog {
  id: UUID;
  org_id: UUID;
  automation_id: UUID;
  /** Snapshot do evento que disparou (ex: a mensagem recebida) */
  trigger_event: Json;
  /** Resultado de cada ação executada */
  actions_executed: Json;
  status: AutomationLogStatus;
  error: string | null;
  duration_ms: number | null;
  created_at: ISODateString;
}
