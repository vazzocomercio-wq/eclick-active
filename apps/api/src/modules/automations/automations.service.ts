import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import type {
  Automation,
  AutomationLogStatus,
  AutomationTriggerType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { PlaceholderService } from '../../common/placeholder/placeholder.service';
import { AnthropicClient } from '../ai/anthropic.client';
import {
  type ActionExecutionLog,
  type AnyTriggerEvent,
  type AutomationAction,
  type GeneratedAutomation,
  GENERATE_SCHEMA,
  GENERATE_SYSTEM_PROMPT,
} from './automation.types';
import {
  CreateAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';

export interface AutomationLogRow {
  id: string;
  automation_id: string;
  status: AutomationLogStatus;
  error: string | null;
  duration_ms: number | null;
  trigger_event: Record<string, unknown>;
  actions_executed: ActionExecutionLog[];
  created_at: string;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly anthropic: AnthropicClient,
    private readonly placeholders: PlaceholderService,
  ) {}

  // ────────────────────────────────────────────
  // CRUD
  // ────────────────────────────────────────────

  async create(
    orgId: string,
    dto: CreateAutomationDto,
    createdBy: string | null,
  ): Promise<Automation> {
    await this.assertWithinPlanLimit(orgId);

    const { data, error } = await this.supabase.adminClient
      .from('automations')
      .insert({
        org_id: orgId,
        name: dto.name,
        description: dto.description ?? null,
        trigger_type: dto.trigger_type,
        trigger_config: dto.trigger_config ?? {},
        actions: dto.actions,
        is_active: dto.is_active ?? false,
        natural_language_source: dto.natural_language_source ?? null,
        stage_id: dto.stage_id ?? null,
        created_by: createdBy,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create automation',
      );
    }
    return data as Automation;
  }

  async findAll(
    orgId: string,
    options: { stageId?: string | null; globalOnly?: boolean } = {},
  ): Promise<Automation[]> {
    let q = this.supabase.adminClient
      .from('automations')
      .select('*')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false });

    // Funil Digital: lista automações de UM stage específico
    if (options.stageId !== undefined && options.stageId !== null) {
      q = q.eq('stage_id', options.stageId);
    } else if (options.globalOnly) {
      q = q.is('stage_id', null);
    }

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as Automation[];
  }

  async findById(orgId: string, id: string): Promise<Automation> {
    const { data, error } = await this.supabase.adminClient
      .from('automations')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Automation ${id} not found`);
    return data as Automation;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateAutomationDto,
  ): Promise<Automation> {
    await this.findById(orgId, id);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.trigger_type !== undefined) patch.trigger_type = dto.trigger_type;
    if (dto.trigger_config !== undefined) patch.trigger_config = dto.trigger_config;
    if (dto.actions !== undefined) patch.actions = dto.actions;
    if (dto.is_active !== undefined) patch.is_active = dto.is_active;
    if (dto.stage_id !== undefined) patch.stage_id = dto.stage_id;

    const { data, error } = await this.supabase.adminClient
      .from('automations')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update automation',
      );
    }
    return data as Automation;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('automations')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async toggle(orgId: string, id: string): Promise<Automation> {
    const current = await this.findById(orgId, id);
    return this.update(orgId, id, { is_active: !current.is_active });
  }

  async getLogs(orgId: string, id: string, limit = 20): Promise<AutomationLogRow[]> {
    await this.findById(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('automation_logs')
      .select('*')
      .eq('org_id', orgId)
      .eq('automation_id', id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AutomationLogRow[];
  }

  // ────────────────────────────────────────────
  // GENERATE FROM NATURAL LANGUAGE (IA)
  // ────────────────────────────────────────────

  async generateFromNaturalLanguage(
    orgId: string,
    description: string,
  ): Promise<GeneratedAutomation> {
    const userPrompt = `Descrição do usuário:
"${description.trim()}"

Gere o JSON da automação seguindo o schema. Use textos PT-BR claros e específicos.`;

    const { data } = await this.anthropic.complete<GeneratedAutomation>({
      interaction_type: 'generate_automation',
      org_id: orgId,
      system: GENERATE_SYSTEM_PROMPT,
      user: userPrompt,
      schema: GENERATE_SCHEMA,
      max_tokens: 1500,
    });

    return {
      name: (data.name ?? '').trim() || 'Automação sem nome',
      description: (data.description ?? '').trim(),
      trigger_type: data.trigger_type,
      trigger_config: data.trigger_config ?? {},
      actions: Array.isArray(data.actions) ? data.actions : [],
    };
  }

  // ────────────────────────────────────────────
  // AUTOMATION → NATURAL LANGUAGE (reverse — pra dual builder)
  // ────────────────────────────────────────────

  /**
   * Converte uma automação estruturada em descrição PT-BR legível.
   * Usado pelo builder dual: ao editar visualmente o usuário, atualiza o
   * lado de texto pra manter sync.
   */
  async automationToNaturalLanguage(
    orgId: string,
    args: {
      trigger_type: AutomationTriggerType;
      trigger_config: Record<string, unknown>;
      actions: AutomationAction[];
      name?: string;
    },
  ): Promise<{ description: string }> {
    const userPrompt = [
      `Tipo de gatilho: ${args.trigger_type}`,
      `Configuração do gatilho: ${JSON.stringify(args.trigger_config ?? {}, null, 2)}`,
      `Ações (em ordem):`,
      ...args.actions.map((a, i) => `${i + 1}. ${JSON.stringify(a)}`),
    ].join('\n');

    const { data } = await this.anthropic.complete<string>({
      interaction_type: 'generate_automation',
      org_id: orgId,
      system: AUTOMATION_TO_TEXT_SYSTEM,
      user: userPrompt,
      max_tokens: 400,
    });

    return { description: (data ?? '').trim() };
  }

  // ────────────────────────────────────────────
  // CHECK TRIGGERS — chamado de fora (webhook, deals, etc)
  // ────────────────────────────────────────────

  /**
   * Lista automações ativas que casam com `event` e dispara `execute` em
   * fire-and-forget (errors logados, não propagados).
   */
  async checkTriggers(event: AnyTriggerEvent): Promise<void> {
    try {
      // Pra eventos de deal, descobre o stage atual pra filtrar automações
      // vinculadas a stage. Eventos sem deal_id ignoram esse filtro.
      const dealStageId = await this.resolveDealStageForEvent(event);

      let q = this.supabase.adminClient
        .from('automations')
        .select('*')
        .eq('org_id', event.org_id)
        .eq('is_active', true)
        .eq('trigger_type', event.event);

      // Funil Digital: pra eventos com stage conhecida, casa automações
      // globais (stage_id IS NULL) OU automações vinculadas a esse stage.
      // Pra eventos sem stage (ex: contact_created, message_received de
      // conversa sem deal), pega só globais.
      if (dealStageId) {
        q = q.or(`stage_id.is.null,stage_id.eq.${dealStageId}`);
      } else {
        q = q.is('stage_id', null);
      }

      const { data, error } = await q;
      if (error) {
        this.logger.warn(`checkTriggers query failed: ${error.message}`);
        return;
      }

      const matches = ((data ?? []) as Automation[]).filter((a) =>
        this.triggerMatchesEvent(a, event),
      );

      // Fire-and-forget — execute cada uma em paralelo
      for (const a of matches) {
        void this.execute(event.org_id, a.id, event, a).catch((err) => {
          this.logger.error(
            `execute ${a.id} failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
      }
    } catch (err) {
      this.logger.warn(
        `checkTriggers caught: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Confirma que `event` satisfaz `automation.trigger_config`. Faz match
   * estrito apenas nas chaves presentes no config (campos ausentes = wildcard).
   */
  private triggerMatchesEvent(
    automation: Automation,
    event: AnyTriggerEvent,
  ): boolean {
    const cfg = (automation.trigger_config ?? {}) as Record<string, unknown>;

    if (event.event === 'message_received') {
      if (cfg.channel_type && cfg.channel_type !== event.channel_type) return false;
      if (
        cfg.contains_text &&
        typeof cfg.contains_text === 'string' &&
        !event.message_text
          .toLowerCase()
          .includes((cfg.contains_text as string).toLowerCase())
      ) {
        return false;
      }
      if (cfg.intent && cfg.intent !== event.ai_intent) return false;
      return true;
    }

    if (event.event === 'deal_stage_changed') {
      if (cfg.pipeline_id && cfg.pipeline_id !== event.pipeline_id) return false;
      if (cfg.from_stage_id && cfg.from_stage_id !== event.from_stage_id) return false;
      if (cfg.to_stage_id && cfg.to_stage_id !== event.to_stage_id) return false;
      return true;
    }

    if (event.event === 'deal_created') {
      if (cfg.pipeline_id && cfg.pipeline_id !== event.pipeline_id) return false;
      return true;
    }

    if (event.event === 'contact_created') {
      if (cfg.source && cfg.source !== event.source) return false;
      return true;
    }

    // Commerce: filtros opcionais por valor mínimo
    if (
      event.event === 'cart_abandoned' ||
      event.event === 'cart_recovered' ||
      event.event === 'order_created' ||
      event.event === 'order_paid'
    ) {
      const minTotal = Number(cfg.min_total ?? 0);
      const evtTotal = (event as { total?: number }).total ?? 0;
      if (minTotal > 0 && evtTotal < minTotal) return false;
      return true;
    }

    return true;
  }

  // ────────────────────────────────────────────
  // EXECUTE — roda actions em sequência, loga
  // ────────────────────────────────────────────

  async execute(
    orgId: string,
    automationId: string,
    triggerEvent: AnyTriggerEvent | { event: 'manual'; org_id: string },
    automation?: Automation,
  ): Promise<{ status: AutomationLogStatus; logs: ActionExecutionLog[] }> {
    const start = performance.now();
    const auto = automation ?? (await this.findById(orgId, automationId));

    const actions = (auto.actions ?? []) as AutomationAction[];
    const logs: ActionExecutionLog[] = [];
    const ctx: ExecuteContext = await this.buildContext(orgId, triggerEvent);

    let status: AutomationLogStatus = 'success';
    let firstError: string | null = null;

    for (let i = 0; i < actions.length; i += 1) {
      const action = actions[i];
      if (!action || typeof action !== 'object') continue;
      const actionStart = performance.now();
      try {
        const output = await this.runAction(action, ctx);
        logs.push({
          index: i,
          type: action.type,
          status: 'success',
          duration_ms: Math.round(performance.now() - actionStart),
          output,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!firstError) firstError = message;
        status = 'partial';
        logs.push({
          index: i,
          type: action.type,
          status: 'failed',
          duration_ms: Math.round(performance.now() - actionStart),
          error: message,
        });
        // Continua executando as próximas — equivale a "best effort".
        // Pra "fail fast" no futuro, basta dar break aqui.
      }
    }

    if (logs.length === 0) status = 'success';
    if (logs.every((l) => l.status === 'failed') && logs.length > 0) {
      status = 'failed';
    }

    const duration = Math.round(performance.now() - start);

    // Log + bumps em paralelo (não bloqueia retorno em caso de falha de log)
    await Promise.all([
      this.persistLog(orgId, automationId, {
        triggerEvent,
        status,
        error: firstError,
        durationMs: duration,
        actions: logs,
      }),
      this.bumpAutomationCounters(orgId, automationId),
    ]).catch(() => {});

    return { status, logs };
  }

  private async runAction(
    action: AutomationAction,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown> | undefined> {
    switch (action.type) {
      case 'send_message':
        return this.actionSendMessage(action, ctx);
      case 'create_task':
        return this.actionCreateTask(action, ctx);
      case 'move_deal':
        return this.actionMoveDeal(action, ctx);
      case 'update_contact':
        return this.actionUpdateContact(action, ctx);
      case 'assign_conversation':
        return this.actionAssignConversation(action, ctx);
      case 'notify_agent':
        return this.actionNotifyAgent(action, ctx);
      case 'wait':
        return this.actionWait(action);
      case 'condition':
        return this.actionCondition(action, ctx);
      case 'send_order_update':
        return this.actionSendOrderUpdate(action, ctx);
      case 'send_tracking':
        return this.actionSendTracking(action, ctx);
      case 'request_review':
        return this.actionRequestReview(action, ctx);
      case 'suggest_reorder':
        return this.actionSuggestReorder(action, ctx);
      default:
        throw new Error(`Action type desconhecido: ${(action as { type: string }).type}`);
    }
  }

  // ────────────────────────────────────────────
  // ACTION: condition (Bloco F — if/else)
  // ────────────────────────────────────────────

  private async actionCondition(
    action: Extract<AutomationAction, { type: 'condition' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    const result = await this.evaluateCondition(action, ctx);
    const branch = result ? action.then_actions : action.else_actions ?? [];
    const branchLogs: Array<{ type: string; status: string; error?: string }> = [];

    for (const sub of branch) {
      try {
        await this.runAction(sub, ctx);
        branchLogs.push({ type: sub.type, status: 'ok' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        branchLogs.push({ type: sub.type, status: 'failed', error: msg });
      }
    }

    return {
      check: action.check,
      result,
      branch: result ? 'then' : 'else',
      sub_actions: branchLogs,
    };
  }

  private async evaluateCondition(
    action: Extract<AutomationAction, { type: 'condition' }>,
    ctx: ExecuteContext,
  ): Promise<boolean> {
    switch (action.check) {
      case 'contact_has_email': {
        if (!ctx.contactId) return false;
        const { data } = await this.supabase.adminClient
          .from('contacts')
          .select('email')
          .eq('org_id', ctx.orgId)
          .eq('id', ctx.contactId)
          .maybeSingle();
        return !!(data as { email: string | null } | null)?.email;
      }
      case 'deal_value_above': {
        if (!ctx.dealId) return false;
        const threshold = Number(action.value) || 0;
        const { data } = await this.supabase.adminClient
          .from('deals')
          .select('value')
          .eq('org_id', ctx.orgId)
          .eq('id', ctx.dealId)
          .maybeSingle();
        const v = Number((data as { value: number | null } | null)?.value ?? 0);
        return v > threshold;
      }
      case 'field_equals': {
        if (!action.field) return false;
        const value = await this.resolveFieldValue(action.field, ctx);
        return String(value ?? '') === String(action.value ?? '');
      }
      case 'field_empty': {
        if (!action.field) return false;
        const value = await this.resolveFieldValue(action.field, ctx);
        return value === null || value === undefined || value === '';
      }
      case 'time_elapsed_min': {
        // Tempo desde a última mensagem da conversa em minutos
        if (!ctx.conversationId) return false;
        const minutes = Number(action.value) || 0;
        const { data } = await this.supabase.adminClient
          .from('conversations')
          .select('last_message_at')
          .eq('org_id', ctx.orgId)
          .eq('id', ctx.conversationId)
          .maybeSingle();
        const last = (data as { last_message_at: string | null } | null)?.last_message_at ?? null;
        if (!last) return false;
        const elapsedMin = (Date.now() - new Date(last).getTime()) / 60_000;
        return elapsedMin > minutes;
      }
      case 'ai_confidence_above':
        // Sem ai_confidence no contexto atual; default false (TODO: passar via ctx)
        return false;
      default:
        return false;
    }
  }

  /**
   * Resolve um caminho como "contact.temperature", "deal.value", "conversation.status"
   * lendo do banco. Retorna string|null|number etc. ou undefined se não resolveu.
   */
  private async resolveFieldValue(
    path: string,
    ctx: ExecuteContext,
  ): Promise<unknown> {
    const [entity, field] = path.split('.');
    if (!entity || !field) return undefined;

    if (entity === 'contact' && ctx.contactId) {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select(field)
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.contactId)
        .maybeSingle();
      return (data as Record<string, unknown> | null)?.[field];
    }
    if (entity === 'deal' && ctx.dealId) {
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select(field)
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.dealId)
        .maybeSingle();
      return (data as Record<string, unknown> | null)?.[field];
    }
    if (entity === 'conversation' && ctx.conversationId) {
      const { data } = await this.supabase.adminClient
        .from('conversations')
        .select(field)
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.conversationId)
        .maybeSingle();
      return (data as Record<string, unknown> | null)?.[field];
    }
    return undefined;
  }

  // ────────────────────────────────────────────
  // ACTION RUNNERS
  // ────────────────────────────────────────────

  private async actionSendMessage(
    action: Extract<AutomationAction, { type: 'send_message' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.conversationId || !ctx.contactId) {
      throw new Error('send_message requer conversation_id + contact_id no contexto');
    }

    const channelId = action.channel_id ?? ctx.channelId;
    if (!channelId) {
      throw new Error('send_message: nenhum channel_id disponível no contexto');
    }

    const text = await this.interpolateRich(action.text, ctx);

    const result = await this.dispatcher.send({
      org_id: ctx.orgId,
      channel_id: channelId,
      contact_id: ctx.contactId,
      content_type: 'text',
      content: { body: text },
    });

    return { channel_message_id: result.channel_message_id, status: result.status };
  }

  private async actionCreateTask(
    action: Extract<AutomationAction, { type: 'create_task' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    const due =
      action.due_in_hours && action.due_in_hours > 0
        ? new Date(Date.now() + action.due_in_hours * 3_600_000).toISOString()
        : null;

    const assigned = ctx.assignedToUserId ?? (await this.fetchAnyOwnerOrAdmin(ctx.orgId));
    if (!assigned) throw new Error('create_task: nenhum usuário disponível para atribuir');

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .insert({
        org_id: ctx.orgId,
        title: this.interpolate(action.title, ctx),
        task_type: action.task_type ?? 'follow_up',
        priority: action.priority ?? 'normal',
        status: 'pending',
        contact_id: ctx.contactId ?? null,
        deal_id: ctx.dealId ?? null,
        conversation_id: ctx.conversationId ?? null,
        assigned_to: assigned,
        due_date: due,
        created_by_ai: true,
        ai_context: 'Criada por automação',
      })
      .select('id')
      .single();

    if (error || !data) throw new Error(`create_task falhou: ${error?.message}`);
    return { task_id: (data as { id: string }).id };
  }

  private async actionMoveDeal(
    action: Extract<AutomationAction, { type: 'move_deal' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.dealId) throw new Error('move_deal requer deal_id no contexto');

    const { error } = await this.supabase.adminClient
      .from('deals')
      .update({
        stage_id: action.to_stage_id,
        stage_entered_at: new Date().toISOString(),
      })
      .eq('org_id', ctx.orgId)
      .eq('id', ctx.dealId);

    if (error) throw new Error(`move_deal falhou: ${error.message}`);
    return { deal_id: ctx.dealId, to_stage_id: action.to_stage_id };
  }

  private async actionUpdateContact(
    action: Extract<AutomationAction, { type: 'update_contact' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.contactId) throw new Error('update_contact requer contact_id no contexto');

    const patch: Record<string, unknown> = {};

    // tags: read-modify-write (evita perder tags existentes)
    if ((action.add_tags && action.add_tags.length > 0) || (action.remove_tags && action.remove_tags.length > 0)) {
      const { data: contact } = await this.supabase.adminClient
        .from('contacts')
        .select('tags')
        .eq('org_id', ctx.orgId)
        .eq('id', ctx.contactId)
        .maybeSingle();

      const currentTags = (contact as { tags: string[] } | null)?.tags ?? [];
      const tags = new Set(currentTags);
      for (const t of action.add_tags ?? []) tags.add(t);
      for (const t of action.remove_tags ?? []) tags.delete(t);
      patch.tags = Array.from(tags);
    }

    if (action.temperature) {
      patch.temperature = action.temperature;
    }

    if (Object.keys(patch).length === 0) {
      return { skipped: true };
    }

    const { error } = await this.supabase.adminClient
      .from('contacts')
      .update(patch)
      .eq('org_id', ctx.orgId)
      .eq('id', ctx.contactId);

    if (error) throw new Error(`update_contact falhou: ${error.message}`);
    return { contact_id: ctx.contactId, patch };
  }

  private async actionAssignConversation(
    action: Extract<AutomationAction, { type: 'assign_conversation' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.conversationId) {
      throw new Error('assign_conversation requer conversation_id no contexto');
    }

    const { error } = await this.supabase.adminClient
      .from('conversations')
      .update({ assigned_to: action.assigned_to })
      .eq('org_id', ctx.orgId)
      .eq('id', ctx.conversationId);

    if (error) throw new Error(`assign_conversation falhou: ${error.message}`);
    return { conversation_id: ctx.conversationId, assigned_to: action.assigned_to };
  }

  private async actionNotifyAgent(
    action: Extract<AutomationAction, { type: 'notify_agent' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    const userId = action.user_id ?? ctx.assignedToUserId;
    if (!userId) {
      throw new Error('notify_agent: nenhum user_id disponível');
    }

    const { error } = await this.supabase.adminClient.from('notifications').insert({
      org_id: ctx.orgId,
      user_id: userId,
      title: 'Automação notificou',
      body: this.interpolate(action.message, ctx),
      type: 'automation_executed',
      severity: 'info',
      entity_type: ctx.dealId ? 'deal' : ctx.conversationId ? 'conversation' : null,
      entity_id: ctx.dealId ?? ctx.conversationId ?? null,
    });

    if (error) throw new Error(`notify_agent falhou: ${error.message}`);
    return { user_id: userId };
  }

  private async actionWait(
    action: Extract<AutomationAction, { type: 'wait' }>,
  ): Promise<Record<string, unknown>> {
    // Não bloqueia o event loop com `setTimeout` longo — limita a 5 minutos
    // como hard cap (waits maiores deveriam virar jobs scheduled).
    const ms = Math.min(Math.max(0, action.minutes), 5) * 60_000;
    await new Promise((resolve) => setTimeout(resolve, ms));
    return { waited_minutes: ms / 60_000 };
  }

  // ────────────────────────────────────────────
  // ACTIONS B6: pós-venda
  // ────────────────────────────────────────────

  private async actionSendOrderUpdate(
    action: Extract<AutomationAction, { type: 'send_order_update' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.order) throw new Error('send_order_update requer order no contexto');
    const text =
      action.text ??
      this.defaultOrderUpdateTemplate(ctx);
    return this.sendCommerceMessage(text, ctx, {
      kind: 'order_update',
      order_id: ctx.order.id,
    });
  }

  private async actionSendTracking(
    action: Extract<AutomationAction, { type: 'send_tracking' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.order) throw new Error('send_tracking requer order no contexto');
    if (!ctx.order.tracking_code) {
      throw new Error('send_tracking: pedido sem tracking_code');
    }
    const carrierLine = ctx.order.carrier
      ? `Transportadora: ${ctx.order.carrier}\n`
      : '';
    const text =
      action.text ??
      `📦 Boa notícia, {{contact.first_name}}! Seu pedido {{order.number}} foi enviado.\n\n${carrierLine}Código de rastreio: *{{order.tracking_code}}*`;
    return this.sendCommerceMessage(text, ctx, {
      kind: 'tracking',
      order_id: ctx.order.id,
      tracking_code: ctx.order.tracking_code,
    });
  }

  private async actionRequestReview(
    action: Extract<AutomationAction, { type: 'request_review' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.order) throw new Error('request_review requer order no contexto');
    const text =
      action.text ??
      `Oi {{contact.first_name}}! 😊 Seu pedido {{order.number}} chegou ok? Sua opinião ajuda muito a gente — pode responder aqui mesmo o que achou?`;
    return this.sendCommerceMessage(text, ctx, {
      kind: 'review_request',
      order_id: ctx.order.id,
    });
  }

  private async actionSuggestReorder(
    action: Extract<AutomationAction, { type: 'suggest_reorder' }>,
    ctx: ExecuteContext,
  ): Promise<Record<string, unknown>> {
    if (!ctx.order) throw new Error('suggest_reorder requer order no contexto');

    // Busca items do pedido pra montar sugestão (best-effort)
    const { data: order } = await this.supabase.adminClient
      .from('whatsapp_orders')
      .select('items')
      .eq('id', ctx.order.id)
      .maybeSingle();
    const items =
      ((order as { items?: Array<{ name: string; quantity: number }> } | null)
        ?.items ?? []) as Array<{ name: string; quantity: number }>;

    const itemList = items
      .slice(0, 5)
      .map((i) => `• ${i.name} (${i.quantity}x)`)
      .join('\n');

    const text =
      action.text ??
      `Oi {{contact.first_name}}! 👋 Já faz um tempinho desde seu último pedido. Quer repor:\n\n${itemList || '(itens do pedido anterior)'}\n\nÉ só responder e a gente te ajuda!`;

    return this.sendCommerceMessage(text, ctx, {
      kind: 'reorder_suggestion',
      order_id: ctx.order.id,
      items_count: items.length,
    });
  }

  /**
   * Envia mensagem em uma conversa do contato + loga evento na timeline.
   * Resolve channelId e conversationId se não vierem no ctx (busca via
   * última conversa WhatsApp do contato).
   */
  private async sendCommerceMessage(
    text: string,
    ctx: ExecuteContext,
    timelineMeta: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!ctx.contactId) throw new Error('Requer contact_id no contexto');

    const { conversationId, channelId } = await this.resolveContactChannel(
      ctx.orgId,
      ctx.contactId,
      ctx.conversationId ?? null,
      ctx.channelId ?? null,
    );
    if (!conversationId || !channelId) {
      throw new Error(
        'Contato sem conversa WhatsApp ativa pra enviar mensagem',
      );
    }

    const finalText = await this.interpolateRich(text, ctx);

    const result = await this.dispatcher.send({
      org_id: ctx.orgId,
      channel_id: channelId,
      contact_id: ctx.contactId,
      content_type: 'text',
      content: { body: finalText },
    });

    // Loga evento na timeline (best-effort)
    if (ctx.order) {
      try {
        await this.supabase.adminClient
          .from('whatsapp_order_events')
          .insert({
            org_id: ctx.orgId,
            order_id: ctx.order.id,
            event_type: `message:${(timelineMeta.kind as string) ?? 'manual'}`,
            description: finalText.slice(0, 200),
            actor_type: 'automation',
            metadata: {
              ...timelineMeta,
              channel_message_id: result.channel_message_id,
            },
          });
      } catch {
        /* best-effort */
      }
    }

    return {
      channel_message_id: result.channel_message_id,
      status: result.status,
      kind: timelineMeta.kind,
    };
  }

  /**
   * Resolve channel + conversation pra enviar mensagem ao contato.
   * Prioridade: ctx values → primary_whatsapp_channel + última conversa.
   */
  private async resolveContactChannel(
    orgId: string,
    contactId: string,
    ctxConversationId: string | null,
    ctxChannelId: string | null,
  ): Promise<{ conversationId: string | null; channelId: string | null }> {
    if (ctxConversationId && ctxChannelId) {
      return { conversationId: ctxConversationId, channelId: ctxChannelId };
    }

    // Busca última conversa WhatsApp do contato
    const { data: convs } = await this.supabase.adminClient
      .from('conversations')
      .select('id, channel_id, channels:channel_id(channel_type)')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(5);

    type ConvRow = {
      id: string;
      channel_id: string;
      // PostgREST embed pode vir como objeto OU array dependendo da relação;
      // tratamos como array pra ser robusto.
      channels: Array<{ channel_type: string }> | { channel_type: string } | null;
    };
    const wa = ((convs ?? []) as unknown as ConvRow[]).find((c) => {
      const ch = Array.isArray(c.channels) ? c.channels[0] : c.channels;
      return ch?.channel_type === 'whatsapp';
    });

    if (wa) {
      return { conversationId: wa.id, channelId: wa.channel_id };
    }

    // Fallback: pega primeiro channel WhatsApp ativo da org
    const { data: ch } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel_type', 'whatsapp')
      .eq('is_active', true)
      .limit(1)
      .maybeSingle();

    return {
      conversationId: ctxConversationId ?? null,
      channelId:
        ctxChannelId ?? (ch as { id: string } | null)?.id ?? null,
    };
  }

  private defaultOrderUpdateTemplate(ctx: ExecuteContext): string {
    return (
      `Oi {{contact.first_name}}! Atualização do seu pedido {{order.number}}:\n\n` +
      `Total: {{order.total}}\n\n` +
      `Qualquer dúvida é só responder aqui. 🛒`
    );
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  /**
   * Pra eventos do tipo `deal_*`, retorna o `stage_id` atual do deal —
   * usado em `checkTriggers` pra filtrar automações vinculadas a stage.
   * Pra eventos sem deal, retorna null (cai no path "só globais").
   */
  private async resolveDealStageForEvent(
    event: AnyTriggerEvent,
  ): Promise<string | null> {
    const dealId =
      event.event === 'deal_stage_changed'
        ? event.deal_id
        : event.event === 'deal_created'
          ? event.deal_id
          : null;
    if (!dealId) {
      // Event types like message_received chegam ANTES do deal_id ser
      // criado/conhecido — passa null pra pegar só globais.
      return null;
    }
    // Pro deal_stage_changed, podemos preferir o stage destino do payload
    if (event.event === 'deal_stage_changed') {
      return event.to_stage_id ?? null;
    }
    // Pro deal_created, busca o stage atual no DB
    try {
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select('stage_id')
        .eq('id', dealId)
        .maybeSingle();
      return (data as { stage_id: string } | null)?.stage_id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Resolve placeholders simples (compat) + se text contém `{{categoria.campo}}`
   * canônico, faz fallback async pelo `PlaceholderService` que carrega dados
   * completos. NOTE: chamada async é feita em `interpolateRich`. Este método
   * cobre o fast-path (legacy {{contact.name}} + {{contact.first_name}}).
   */
  private interpolate(text: string, ctx: ExecuteContext): string {
    let out = text
      .replace(/\{\{contact\.name\}\}/g, ctx.contactName ?? 'cliente')
      .replace(
        /\{\{contact\.first_name\}\}/g,
        (ctx.contactName ?? 'cliente').split(' ')[0] ?? 'cliente',
      );

    if (ctx.cart) {
      out = out
        .replace(/\{\{cart\.total\}\}/g, formatBRL(ctx.cart.total))
        .replace(/\{\{cart\.items_count\}\}/g, String(ctx.cart.items_count));
    }
    if (ctx.order) {
      out = out
        .replace(/\{\{order\.number\}\}/g, ctx.order.display_number)
        .replace(/\{\{order\.total\}\}/g, formatBRL(ctx.order.total))
        .replace(
          /\{\{order\.tracking_code\}\}/g,
          ctx.order.tracking_code ?? '—',
        )
        .replace(/\{\{order\.carrier\}\}/g, ctx.order.carrier ?? '—');
    }
    return out;
  }

  /**
   * Versão async com lookup completo via `PlaceholderService`. Usada em
   * actions onde temos `ctx.dealId`/`contactId` e queremos `{{deal.titulo}}`,
   * `{{contato.email}}`, etc. Best-effort: se buildContext falhar, cai no
   * fallback simples.
   */
  private async interpolateRich(text: string, ctx: ExecuteContext): Promise<string> {
    if (!text || !text.includes('{{')) return text;
    try {
      const placeholderCtx = await this.placeholders.buildContext({
        orgId: ctx.orgId,
        ...(ctx.dealId ? { dealId: ctx.dealId } : {}),
        ...(ctx.contactId ? { contactId: ctx.contactId } : {}),
        ...(ctx.assignedToUserId ? { userId: ctx.assignedToUserId } : {}),
      });
      return this.placeholders.resolve(text, placeholderCtx);
    } catch {
      return this.interpolate(text, ctx);
    }
  }

  private async buildContext(
    orgId: string,
    event: AnyTriggerEvent | { event: 'manual'; org_id: string },
  ): Promise<ExecuteContext> {
    const ctx: ExecuteContext = { orgId };

    if (event.event === 'message_received') {
      ctx.conversationId = event.conversation_id;
      ctx.contactId = event.contact_id ?? undefined;
      ctx.channelId = event.channel_id;
    } else if (event.event === 'deal_stage_changed' || event.event === 'deal_created') {
      ctx.dealId = event.deal_id;
      ctx.contactId = event.contact_id ?? undefined;
    } else if (event.event === 'contact_created') {
      ctx.contactId = event.contact_id;
    } else if (
      event.event === 'cart_abandoned' ||
      event.event === 'cart_recovered'
    ) {
      ctx.contactId = event.contact_id;
      ctx.conversationId = event.conversation_id ?? undefined;
      ctx.cart = {
        id: event.cart_id,
        total: event.total,
        items_count:
          (event as { items_count?: number }).items_count ?? 0,
      };
    } else if (
      event.event === 'order_created' ||
      event.event === 'order_paid' ||
      event.event === 'order_shipped'
    ) {
      ctx.contactId = event.contact_id;
      ctx.conversationId = event.conversation_id ?? undefined;
      ctx.order = {
        id: event.order_id,
        display_number: event.display_number,
        total: (event as { total?: number }).total ?? 0,
        tracking_code: (event as { tracking_code?: string | null }).tracking_code ?? null,
        carrier: (event as { carrier?: string | null }).carrier ?? null,
      };
    }

    // Hidrata nome do contato + assigned_to da conversa em uma única query
    if (ctx.contactId) {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name')
        .eq('org_id', orgId)
        .eq('id', ctx.contactId)
        .maybeSingle();
      ctx.contactName = (data as { name: string | null } | null)?.name ?? null;
    }

    if (ctx.conversationId) {
      const { data } = await this.supabase.adminClient
        .from('conversations')
        .select('assigned_to')
        .eq('org_id', orgId)
        .eq('id', ctx.conversationId)
        .maybeSingle();
      ctx.assignedToUserId =
        (data as { assigned_to: string | null } | null)?.assigned_to ?? undefined;
    }

    return ctx;
  }

  private async persistLog(
    orgId: string,
    automationId: string,
    args: {
      triggerEvent: unknown;
      status: AutomationLogStatus;
      error: string | null;
      durationMs: number;
      actions: ActionExecutionLog[];
    },
  ): Promise<void> {
    await this.supabase.adminClient.from('automation_logs').insert({
      org_id: orgId,
      automation_id: automationId,
      trigger_event: args.triggerEvent,
      actions_executed: args.actions,
      status: args.status,
      error: args.error,
      duration_ms: args.durationMs,
    });
  }

  private async bumpAutomationCounters(
    orgId: string,
    automationId: string,
  ): Promise<void> {
    // Increment via RPC seria mais correto pra concorrência. Aqui usamos
    // read-modify-write — race conditions resultam em count subestimado
    // mas não em corrupção.
    const { data: current } = await this.supabase.adminClient
      .from('automations')
      .select('execution_count')
      .eq('org_id', orgId)
      .eq('id', automationId)
      .maybeSingle();

    await this.supabase.adminClient
      .from('automations')
      .update({
        execution_count:
          ((current as { execution_count: number } | null)?.execution_count ?? 0) + 1,
        last_executed_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)
      .eq('id', automationId);
  }

  private async assertWithinPlanLimit(orgId: string): Promise<void> {
    const [orgResp, countResp] = await Promise.all([
      this.supabase.adminClient
        .from('organizations')
        .select('max_automations')
        .eq('id', orgId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('automations')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId),
    ]);

    const maxAutomations =
      (orgResp.data as { max_automations: number } | null)?.max_automations ?? 5;
    const count = countResp.count ?? 0;

    if (count >= maxAutomations) {
      throw new ConflictException(
        `Limite de ${maxAutomations} automações do plano atingido. Faça upgrade pra adicionar mais.`,
      );
    }
  }

  private async fetchAnyOwnerOrAdmin(orgId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('user_id, role')
      .eq('org_id', orgId)
      .in('role', ['owner', 'admin'])
      .neq('status', 'suspended')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    return (data as { user_id: string } | null)?.user_id ?? null;
  }
}

// ──────────────────────────────────────────────────────────
// Tipos internos
// ──────────────────────────────────────────────────────────

interface ExecuteContext {
  orgId: string;
  conversationId?: string;
  contactId?: string;
  contactName?: string | null;
  channelId?: string;
  dealId?: string;
  assignedToUserId?: string;
  /** Hidratado em buildContext pra cart_abandoned/cart_recovered */
  cart?: {
    id: string;
    total: number;
    items_count: number;
  };
  /** Hidratado em buildContext pra order_* */
  order?: {
    id: string;
    display_number: string;
    total: number;
    tracking_code: string | null;
    carrier: string | null;
  };
}

function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(value) || 0);
}

const AUTOMATION_TO_TEXT_SYSTEM = `Você converte automações de CRM em descrições legíveis em português do Brasil.
A descrição deve ser direta, em uma única frase quando possível, ou no máximo 2 frases.
Use linguagem do tipo "Quando [gatilho], [ações]". Não invente ações que não estão no JSON.
Exemplos:
- "Quando uma mensagem é recebida com a palavra 'orçamento', enviar template de boas-vindas e criar tarefa de follow-up em 24h."
- "Quando um deal é movido para a stage 'Proposta', atribuir ao agente Carlos e enviar template de proposta."
Retorne APENAS a descrição, sem aspas, sem prefixos, sem markdown.`;
