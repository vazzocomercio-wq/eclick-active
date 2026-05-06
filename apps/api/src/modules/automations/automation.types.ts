/**
 * Tipos shared do módulo Automations.
 *
 * Atenção: estes tipos descrevem o "shape interno" das automações que
 * persistimos como JSONB no schema. Mantenha sincronizado com:
 *   - active.automations.actions[]
 *   - active.automations.trigger_config
 *   - active.automation_logs.actions_executed[]
 */

import type { AutomationTriggerType } from '@eclick-active/shared';

// ──────────────────────────────────────────────────────────
// Triggers
// ──────────────────────────────────────────────────────────

export interface MessageReceivedTriggerConfig {
  /** Filtra por canal específico (whatsapp, instagram...) — opcional */
  channel_type?: string;
  /** Texto que a mensagem precisa conter (case-insensitive) — opcional */
  contains_text?: string;
  /** Intent classificada pela IA (budget, complaint, etc) — opcional */
  intent?: string;
}

export interface DealCreatedTriggerConfig {
  pipeline_id?: string;
}

export interface DealStageChangedTriggerConfig {
  pipeline_id?: string;
  /** UUID do stage de origem — opcional */
  from_stage_id?: string;
  /** UUID do stage de destino — opcional */
  to_stage_id?: string;
}

export interface ContactCreatedTriggerConfig {
  source?: string;
}

export interface TaskOverdueTriggerConfig {
  task_type?: string;
}

// ──────────────────────────────────────────────────────────
// Actions — discriminated union por `type`
// ──────────────────────────────────────────────────────────

export type AutomationActionType =
  | 'send_message'
  | 'create_task'
  | 'move_deal'
  | 'update_contact'
  | 'assign_conversation'
  | 'notify_agent'
  | 'wait'
  | 'condition'
  | 'send_order_update'
  | 'send_tracking'
  | 'request_review'
  | 'suggest_reorder';

export type AutomationAction =
  | SendMessageAction
  | CreateTaskAction
  | MoveDealAction
  | UpdateContactAction
  | AssignConversationAction
  | NotifyAgentAction
  | WaitAction
  | ConditionAction
  | SendOrderUpdateAction
  | SendTrackingAction
  | RequestReviewAction
  | SuggestReorderAction;

// ──────────────────────────────────────────────────────────
// Condition action (Bloco F — ramificação if/else)
// ──────────────────────────────────────────────────────────

export type ConditionCheck =
  | 'field_equals'
  | 'field_empty'
  | 'time_elapsed_min'
  | 'ai_confidence_above'
  | 'contact_has_email'
  | 'deal_value_above';

export interface ConditionAction {
  type: 'condition';
  /** Tipo da check */
  check: ConditionCheck;
  /** Valor de comparação (depende do check) */
  value?: string | number | boolean;
  /** Pra `field_equals` / `field_empty` — caminho do campo (ex: "contact.temperature") */
  field?: string;
  /** Ações se a condição for verdadeira */
  then_actions: AutomationAction[];
  /** Ações se a condição for falsa */
  else_actions?: AutomationAction[];
}

export interface SendMessageAction {
  type: 'send_message';
  /** Texto da mensagem. Suporta interpolação simples: {{contact.name}} */
  text: string;
  /** Opcional: força um canal específico em vez do canal da conversa */
  channel_id?: string;
}

export interface CreateTaskAction {
  type: 'create_task';
  title: string;
  /** Tipo da tarefa (call, email, follow_up...) */
  task_type?: string;
  /** Quantas horas a partir de agora — vira due_date */
  due_in_hours?: number;
  /** Prioridade: low/normal/high/urgent */
  priority?: 'low' | 'normal' | 'high' | 'urgent';
}

export interface MoveDealAction {
  type: 'move_deal';
  /** UUID do stage de destino */
  to_stage_id: string;
}

export interface UpdateContactAction {
  type: 'update_contact';
  /** Tags pra ADICIONAR */
  add_tags?: string[];
  /** Tags pra REMOVER */
  remove_tags?: string[];
  /** Sobrescreve a temperatura */
  temperature?: 'cold' | 'warm' | 'hot' | 'very_hot';
}

export interface AssignConversationAction {
  type: 'assign_conversation';
  /** UUID do user_id (org_member) */
  assigned_to: string;
}

export interface NotifyAgentAction {
  type: 'notify_agent';
  /** Texto da notificação */
  message: string;
  /** UUID do user_id que recebe — se omitido usa assigned_to do contexto */
  user_id?: string;
}

export interface WaitAction {
  type: 'wait';
  /** Atraso em minutos */
  minutes: number;
}

// ──────────────────────────────────────────────────────────
// Commerce (B6) — actions específicas de pós-venda
// ──────────────────────────────────────────────────────────

/**
 * Envia mensagem de atualização de status do pedido. Suporta placeholders
 * `{{order.number}}`, `{{order.total}}`, `{{contact.first_name}}`.
 * Se omitido, usa template padrão por status.
 */
export interface SendOrderUpdateAction {
  type: 'send_order_update';
  /** Texto opcional — se omitido usa template default conforme order.status */
  text?: string;
}

/**
 * Envia código + URL de rastreamento. Pega de `ctx.order.tracking_code` /
 * `metadata.tracking_url`. Falha se não houver tracking_code.
 */
export interface SendTrackingAction {
  type: 'send_tracking';
  text?: string;
}

/**
 * Pede review/avaliação do pedido. Texto livre — recomenda mencionar
 * `{{order.number}}` e link de avaliação.
 */
export interface RequestReviewAction {
  type: 'request_review';
  text?: string;
}

/**
 * Sugere recompra dos itens do pedido. Lista produtos do snapshot do
 * pedido, ideal pra produtos consumíveis.
 */
export interface SuggestReorderAction {
  type: 'suggest_reorder';
  text?: string;
}

// ──────────────────────────────────────────────────────────
// Eventos disparáveis (chamados de outros módulos)
// ──────────────────────────────────────────────────────────

export interface TriggerEventBase {
  event: AutomationTriggerType;
}

export interface MessageReceivedEvent extends TriggerEventBase {
  event: 'message_received';
  org_id: string;
  conversation_id: string;
  contact_id: string | null;
  channel_id: string;
  channel_type: string;
  message_id: string;
  message_text: string;
  ai_intent?: string | null;
}

export interface DealCreatedEvent extends TriggerEventBase {
  event: 'deal_created';
  org_id: string;
  deal_id: string;
  pipeline_id: string;
  stage_id: string;
  contact_id: string | null;
}

export interface DealStageChangedEvent extends TriggerEventBase {
  event: 'deal_stage_changed';
  org_id: string;
  deal_id: string;
  pipeline_id: string;
  from_stage_id: string;
  to_stage_id: string;
  contact_id: string | null;
}

export interface ContactCreatedEvent extends TriggerEventBase {
  event: 'contact_created';
  org_id: string;
  contact_id: string;
  source: string | null;
}

export interface WhatsAppVerifiedEvent extends TriggerEventBase {
  event: 'whatsapp_verified';
  org_id: string;
  contact_id: string;
  /** JID canônico retornado pelo provider (Baileys/Z-API) */
  jid: string | null;
  /** Nome do perfil WhatsApp se disponível */
  profile_name: string | null;
  /** 'baileys' | 'zapi' — qual provider validou */
  provider: string;
}

// ── Commerce events ──

export interface CartAbandonedEvent extends TriggerEventBase {
  event: 'cart_abandoned';
  org_id: string;
  cart_id: string;
  contact_id: string;
  conversation_id: string | null;
  items_count: number;
  total: number;
}

export interface CartRecoveredEvent extends TriggerEventBase {
  event: 'cart_recovered';
  org_id: string;
  cart_id: string;
  contact_id: string;
  conversation_id: string | null;
  total: number;
}

export interface OrderCreatedEvent extends TriggerEventBase {
  event: 'order_created';
  org_id: string;
  order_id: string;
  display_number: string;
  contact_id: string;
  conversation_id: string | null;
  total: number;
}

export interface OrderPaidEvent extends TriggerEventBase {
  event: 'order_paid';
  org_id: string;
  order_id: string;
  display_number: string;
  contact_id: string;
  conversation_id: string | null;
  total: number;
}

export interface OrderShippedEvent extends TriggerEventBase {
  event: 'order_shipped';
  org_id: string;
  order_id: string;
  display_number: string;
  contact_id: string;
  conversation_id: string | null;
  tracking_code: string | null;
  carrier: string | null;
}

export type AnyTriggerEvent =
  | MessageReceivedEvent
  | DealCreatedEvent
  | DealStageChangedEvent
  | ContactCreatedEvent
  | WhatsAppVerifiedEvent
  | CartAbandonedEvent
  | CartRecoveredEvent
  | OrderCreatedEvent
  | OrderPaidEvent
  | OrderShippedEvent;

// ──────────────────────────────────────────────────────────
// Log de execução
// ──────────────────────────────────────────────────────────

export interface ActionExecutionLog {
  index: number;
  type: AutomationActionType;
  /** 'success' / 'failed' / 'skipped' (skipped = wait dry-run, etc) */
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  /** Resultado resumido — ex: ID da tarefa criada, msg_id da mensagem enviada */
  output?: Record<string, unknown>;
  error?: string;
}

// ──────────────────────────────────────────────────────────
// Schema gerado pela IA
// ──────────────────────────────────────────────────────────

export interface GeneratedAutomation {
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
}

export const GENERATE_SCHEMA = {
  type: 'object',
  properties: {
    name: { type: 'string' },
    description: { type: 'string' },
    trigger_type: {
      type: 'string',
      enum: [
        'message_received',
        'deal_created',
        'deal_stage_changed',
        'contact_created',
        'whatsapp_verified',
        'task_overdue',
        'manual',
        'cart_abandoned',
        'cart_recovered',
        'order_created',
        'order_paid',
        'order_shipped',
      ],
    },
    trigger_config: {
      type: 'object',
      properties: {
        channel_type: { type: 'string' },
        contains_text: { type: 'string' },
        intent: { type: 'string' },
        pipeline_id: { type: 'string' },
        from_stage_id: { type: 'string' },
        to_stage_id: { type: 'string' },
        source: { type: 'string' },
        task_type: { type: 'string' },
      },
      additionalProperties: false,
    },
    actions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: [
              'send_message',
              'create_task',
              'move_deal',
              'update_contact',
              'assign_conversation',
              'notify_agent',
              'wait',
              'send_order_update',
              'send_tracking',
              'request_review',
              'suggest_reorder',
            ],
          },
          text: { type: 'string' },
          channel_id: { type: 'string' },
          title: { type: 'string' },
          task_type: { type: 'string' },
          due_in_hours: { type: 'number' },
          priority: { type: 'string', enum: ['low', 'normal', 'high', 'urgent'] },
          to_stage_id: { type: 'string' },
          add_tags: { type: 'array', items: { type: 'string' } },
          remove_tags: { type: 'array', items: { type: 'string' } },
          temperature: { type: 'string', enum: ['cold', 'warm', 'hot', 'very_hot'] },
          assigned_to: { type: 'string' },
          message: { type: 'string' },
          user_id: { type: 'string' },
          minutes: { type: 'number' },
        },
        required: ['type'],
        additionalProperties: false,
      },
    },
  },
  required: ['name', 'description', 'trigger_type', 'trigger_config', 'actions'],
  additionalProperties: false,
} as const;

export const GENERATE_SYSTEM_PROMPT = `Você é um especialista em automação de vendas para CRMs brasileiros. Converta uma descrição em português em uma automação estruturada.

Triggers disponíveis:
- message_received: nova mensagem do cliente. Config: channel_type, contains_text, intent (budget/complaint/question/etc).
- deal_created: novo deal criado.
- deal_stage_changed: deal mudou de etapa. Config: from_stage_id, to_stage_id (UUIDs — não invente).
- contact_created: novo contato. Config: source (whatsapp/import/etc).
- whatsapp_verified: contato foi verificado como WhatsApp ativo. Use pra disparar boas-vindas, criar tarefa de primeiro contato, ou marcar tag.
- task_overdue: tarefa atrasou. Config: task_type.
- manual: dispara manualmente.
- cart_abandoned: carrinho WhatsApp marcado como abandonado pelo scheduler. Use pra disparar mensagem de recuperação ({{cart.total}}, {{cart.items_count}}).
- cart_recovered: cliente voltou e ressuscitou um carrinho abandoned. Use pra agradecer ou aplicar cupom.
- order_created: novo pedido criado a partir do carrinho. Use pra notificar agente, mover deal pra "fechado" ou pedir review.
- order_paid: pagamento confirmado. Use pra enviar comprovante, criar tarefa de envio, mover deal.
- order_shipped: pedido marcado como enviado. Use pra mandar tracking ({{order.tracking_code}}, {{order.carrier}}).

Actions disponíveis (execute em ordem):
- send_message: { type, text, channel_id? }. text suporta {{contact.name}}.
- create_task: { type, title, task_type?, due_in_hours?, priority? }.
- move_deal: { type, to_stage_id }.
- update_contact: { type, add_tags?, remove_tags?, temperature? }.
- assign_conversation: { type, assigned_to (UUID) }.
- notify_agent: { type, message, user_id? }.
- wait: { type, minutes }.
- send_order_update: { type, text? }. Pra triggers order_*. Suporta {{order.number}}, {{order.total}}.
- send_tracking: { type, text? }. Pra trigger order_shipped. Falha se sem tracking_code.
- request_review: { type, text? }. Mensagem pedindo review/avaliação.
- suggest_reorder: { type, text? }. Sugere recompra dos itens do pedido.

Diretrizes:
- Use linguagem PT-BR clara nos textos
- Prefira ações curtas e específicas
- Se a descrição mencionar UUIDs/IDs específicos, use-os; caso contrário, omita o campo
- name: 3-7 palavras (ex: "Boas-vindas via WhatsApp")
- description: 1 frase explicando o que faz

Retorne APENAS JSON com o shape definido pelo schema.`;
