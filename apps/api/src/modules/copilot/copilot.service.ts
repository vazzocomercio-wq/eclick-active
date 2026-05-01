import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  COPILOT_SYSTEM_PROMPT,
  MAX_HISTORY_MESSAGES,
  MAX_TOOL_ITERATIONS,
  SONNET_MODEL_ID,
  SONNET_PRICING,
} from './copilot.types';
import { COPILOT_TOOLS, type CopilotToolName } from './copilot.tools';

// ──────────────────────────────────────────────────────────
// Tipos públicos
// ──────────────────────────────────────────────────────────

export interface CopilotMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: ToolCallRecord[];
  metadata: Record<string, unknown>;
  cost_usd: number;
  created_at: string;
}

/**
 * Registro UI-friendly do que aconteceu nas tool calls. NÃO é o shape do
 * Anthropic — é o que o frontend usa para renderizar inline cards.
 */
export interface ToolCallRecord {
  tool: CopilotToolName;
  /** Resumo curto pra UI (ex: "Tarefa criada: Follow-up com João"). */
  summary: string;
  /** ID do recurso criado, se aplicável. */
  resource_id?: string;
  /** Tipo do recurso pra montar o link no frontend. */
  resource_kind?: 'task' | 'deal';
  /** Nº de itens retornados, pra read-only tools. */
  result_count?: number;
}

export interface ProcessQueryResult {
  reply: string;
  tool_calls: ToolCallRecord[];
  cost_usd: number;
  latency_ms: number;
  /** ID do registro assistant criado em copilot_messages. */
  assistant_message_id: string;
}

// ──────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────

@Injectable()
export class CopilotService implements OnModuleInit {
  private readonly logger = new Logger(CopilotService.name);
  private _client?: Anthropic;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit(): void {
    if (!process.env.ANTHROPIC_API_KEY) {
      this.logger.warn('ANTHROPIC_API_KEY ausente — Copiloto vai falhar até a env ser configurada.');
    }
  }

  private getClient(): Anthropic {
    if (this._client) return this._client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY não configurada');
    this._client = new Anthropic({ apiKey, maxRetries: 2 });
    return this._client;
  }

  // ────────────────────────────────────────────
  // Histórico
  // ────────────────────────────────────────────

  async getHistory(orgId: string, userId: string): Promise<CopilotMessageRecord[]> {
    const { data, error } = await this.supabase.adminClient
      .from('copilot_messages')
      .select('id, role, content, tool_calls, metadata, cost_usd, created_at')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(MAX_HISTORY_MESSAGES);

    if (error) {
      this.logger.error(`getHistory failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    // Reverte para ordem cronológica
    return ((data ?? []) as CopilotMessageRecord[]).reverse();
  }

  async clearHistory(orgId: string, userId: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('copilot_messages')
      .delete()
      .eq('org_id', orgId)
      .eq('user_id', userId);

    if (error) {
      this.logger.error(`clearHistory failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // Process query (entry point principal)
  // ────────────────────────────────────────────

  async processQuery(
    orgId: string,
    userId: string,
    userMessage: string,
  ): Promise<ProcessQueryResult> {
    const start = performance.now();

    // 1. Persiste user message imediatamente (idempotência via select-after)
    await this.persistMessage({
      orgId,
      userId,
      role: 'user',
      content: userMessage,
      toolCalls: [],
      costUsd: 0,
    });

    // 2. Carrega histórico (já inclui a user message recém-persistida)
    const history = await this.getHistory(orgId, userId);

    // 3. Monta messages para a API Anthropic
    const messages: Anthropic.MessageParam[] = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));

    // 4. Tool runner loop
    const ctx: ToolContext = { orgId, userId };
    const result = await this.runToolLoop(messages, ctx);

    // 5. Persiste assistant message
    const assistant = await this.persistMessage({
      orgId,
      userId,
      role: 'assistant',
      content: result.reply,
      toolCalls: result.toolCalls,
      costUsd: result.costUsd,
      metadata: {
        latency_ms: Math.round(performance.now() - start),
        iterations: result.iterations,
      },
    });

    // 6. Loga em ai_interactions (audit). Não bloqueia caminho feliz.
    await this.logAiInteraction({
      orgId,
      userId,
      inputTokens: result.totalInputTokens,
      outputTokens: result.totalOutputTokens,
      latencyMs: Math.round(performance.now() - start),
      summary: result.reply.slice(0, 200),
    }).catch((err) => {
      this.logger.warn(
        `ai_interactions log failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    return {
      reply: result.reply,
      tool_calls: result.toolCalls,
      cost_usd: result.costUsd,
      latency_ms: Math.round(performance.now() - start),
      assistant_message_id: assistant.id,
    };
  }

  // ────────────────────────────────────────────
  // Tool runner — multi-turn loop
  // ────────────────────────────────────────────

  private async runToolLoop(
    initialMessages: Anthropic.MessageParam[],
    ctx: ToolContext,
  ): Promise<{
    reply: string;
    toolCalls: ToolCallRecord[];
    costUsd: number;
    iterations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
  }> {
    const messages = [...initialMessages];
    const toolCalls: ToolCallRecord[] = [];
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations += 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = (await this.getClient().messages.create({
        model: SONNET_MODEL_ID,
        max_tokens: 1024,
        system: COPILOT_SYSTEM_PROMPT,
        tools: COPILOT_TOOLS,
        messages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as Anthropic.Message;

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      totalCost += computeSonnetCost(response.usage.input_tokens, response.usage.output_tokens);

      const toolUses = response.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
      );

      // Caso 1: model devolveu só texto → final.
      if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
        const textBlocks = response.content.filter(
          (b): b is Anthropic.TextBlock => b.type === 'text',
        );
        const reply = textBlocks.map((b) => b.text).join('\n').trim();
        return {
          reply: reply || 'Não consegui gerar uma resposta.',
          toolCalls,
          costUsd: round6(totalCost),
          iterations,
          totalInputTokens,
          totalOutputTokens,
        };
      }

      // Caso 2: tool_use blocks presentes → registra como assistant turn (com tool_use)
      messages.push({
        role: 'assistant',
        content: response.content,
      });

      // Executa todas as tools em paralelo
      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUses.map(async (tu) => {
          try {
            const exec = await this.executeTool(
              tu.name as CopilotToolName,
              tu.input as Record<string, unknown>,
              ctx,
            );
            toolCalls.push(exec.record);
            return {
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify(exec.result),
            } satisfies Anthropic.ToolResultBlockParam;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            this.logger.error(`tool ${tu.name} failed: ${msg}`);
            return {
              type: 'tool_result',
              tool_use_id: tu.id,
              content: JSON.stringify({ error: msg }),
              is_error: true,
            } satisfies Anthropic.ToolResultBlockParam;
          }
        }),
      );

      messages.push({ role: 'user', content: toolResults });
    }

    // Atingiu MAX_TOOL_ITERATIONS sem fechar — devolve mensagem genérica
    return {
      reply:
        'Não consegui concluir o raciocínio em tempo hábil. Tenta reformular a pergunta de forma mais específica.',
      toolCalls,
      costUsd: round6(totalCost),
      iterations,
      totalInputTokens,
      totalOutputTokens,
    };
  }

  // ────────────────────────────────────────────
  // Tool dispatch
  // ────────────────────────────────────────────

  private async executeTool(
    name: CopilotToolName,
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    switch (name) {
      case 'search_contacts':
        return this.toolSearchContacts(input, ctx);
      case 'list_deals':
        return this.toolListDeals(input, ctx);
      case 'get_pipeline_summary':
        return this.toolPipelineSummary(input, ctx);
      case 'list_conversations':
        return this.toolListConversations(input, ctx);
      case 'list_tasks':
        return this.toolListTasks(input, ctx);
      case 'get_agent_stats':
        return this.toolAgentStats(input, ctx);
      case 'create_task':
        return this.toolCreateTask(input, ctx);
      case 'create_deal':
        return this.toolCreateDeal(input, ctx);
      default:
        throw new Error(`Tool desconhecida: ${name}`);
    }
  }

  // ────────────────────────────────────────────
  // Tool implementations (todas filtram por orgId via SupabaseService)
  // ────────────────────────────────────────────

  private async toolSearchContacts(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const query = String(input.query ?? '').trim();
    const temperature = input.temperature as string | undefined;
    const limit = clampLimit(Number(input.limit), 10, 25);

    let q = this.supabase.adminClient
      .from('contacts')
      .select('id, name, phone, email, temperature, score, tags')
      .eq('org_id', ctx.orgId)
      .order('score', { ascending: false })
      .limit(limit);

    if (temperature) q = q.eq('temperature', temperature);
    if (query.length > 0) {
      const escaped = query.replace(/[%_,()\\]/g, '');
      q = q.or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const contacts = (data ?? []) as Array<{
      id: string;
      name: string | null;
      phone: string | null;
      email: string | null;
      temperature: string | null;
      score: number;
      tags: string[];
    }>;

    return {
      result: contacts.map((c) => ({
        id: c.id,
        name: c.name ?? '(sem nome)',
        phone: c.phone,
        email: c.email,
        temperature: c.temperature,
        score: c.score,
        tags: c.tags,
      })),
      record: {
        tool: 'search_contacts',
        summary: `Encontrei ${contacts.length} contato${contacts.length === 1 ? '' : 's'}`,
        result_count: contacts.length,
      },
    };
  }

  private async toolListDeals(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const limit = clampLimit(Number(input.limit), 10, 25);
    const onlyAtRisk = input.only_at_risk === true;

    let q = this.supabase.adminClient
      .from('v_deal_board')
      .select(
        'id, title, value, currency, stage_name, ai_score, ai_risk, ai_close_probability, contact_name, sla_breached, hours_in_stage',
      )
      .eq('org_id', ctx.orgId)
      .order('value', { ascending: false })
      .limit(limit);

    if (input.pipeline_id) q = q.eq('pipeline_id', String(input.pipeline_id));
    if (input.stage_id) q = q.eq('stage_id', String(input.stage_id));
    if (input.assigned_to) q = q.eq('assigned_to', String(input.assigned_to));
    if (typeof input.min_value === 'number') q = q.gte('value', input.min_value);
    if (typeof input.max_value === 'number') q = q.lte('value', input.max_value);
    if (onlyAtRisk) q = q.in('ai_risk', ['high', 'critical']);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const deals = (data ?? []) as Array<Record<string, unknown>>;

    return {
      result: deals,
      record: {
        tool: 'list_deals',
        summary: `${deals.length} negócio${deals.length === 1 ? '' : 's'} encontrado${deals.length === 1 ? '' : 's'}`,
        result_count: deals.length,
      },
    };
  }

  private async toolPipelineSummary(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    let pipelineId = input.pipeline_id ? String(input.pipeline_id) : null;

    if (!pipelineId) {
      const { data } = await this.supabase.adminClient
        .from('pipelines')
        .select('id')
        .eq('org_id', ctx.orgId)
        .eq('is_active', true)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      pipelineId = (data as { id: string } | null)?.id ?? null;
    }

    if (!pipelineId) {
      return {
        result: { error: 'Nenhum pipeline ativo encontrado' },
        record: {
          tool: 'get_pipeline_summary',
          summary: 'Nenhum pipeline ativo',
          result_count: 0,
        },
      };
    }

    const [pipelineResp, dealsResp, stagesResp] = await Promise.all([
      this.supabase.adminClient
        .from('pipelines')
        .select('id, name')
        .eq('org_id', ctx.orgId)
        .eq('id', pipelineId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('v_deal_board')
        .select('value, stage_id, stage_probability')
        .eq('org_id', ctx.orgId)
        .eq('pipeline_id', pipelineId),
      this.supabase.adminClient
        .from('pipeline_stages')
        .select('id, name, position, probability, is_won, is_lost')
        .eq('org_id', ctx.orgId)
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: true }),
    ]);

    const pipeline = pipelineResp.data as { id: string; name: string } | null;
    const deals = (dealsResp.data ?? []) as Array<{
      value: number;
      stage_id: string;
      stage_probability: number;
    }>;
    const stages = (stagesResp.data ?? []) as Array<{
      id: string;
      name: string;
      position: number;
      probability: number;
      is_won: boolean;
      is_lost: boolean;
    }>;

    const total_value = deals.reduce((acc, d) => acc + Number(d.value ?? 0), 0);
    const weighted_value = deals.reduce(
      (acc, d) => acc + Number(d.value ?? 0) * (Number(d.stage_probability ?? 0) / 100),
      0,
    );

    const stageStats = stages.map((s) => {
      const stageDeals = deals.filter((d) => d.stage_id === s.id);
      return {
        name: s.name,
        position: s.position,
        deals_count: stageDeals.length,
        total_value: stageDeals.reduce((acc, d) => acc + Number(d.value ?? 0), 0),
      };
    });

    return {
      result: {
        pipeline_name: pipeline?.name ?? 'Pipeline',
        total_deals: deals.length,
        total_value,
        weighted_value,
        stages: stageStats,
      },
      record: {
        tool: 'get_pipeline_summary',
        summary: `Resumo do pipeline "${pipeline?.name ?? '?'}" — ${deals.length} deals, R$ ${total_value.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`,
        result_count: deals.length,
      },
    };
  }

  private async toolListConversations(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const limit = clampLimit(Number(input.limit), 10, 25);

    let q = this.supabase.adminClient
      .from('conversations')
      .select(
        'id, status, priority, unread_count, last_message_at, ai_intent, ai_temperature, contacts:contact_id(name, phone)',
      )
      .eq('org_id', ctx.orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (input.status) q = q.eq('status', String(input.status));
    if (input.priority) q = q.eq('priority', String(input.priority));
    if (input.only_unanswered === true) q = q.gt('unread_count', 0);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const items = ((data ?? []) as Array<{
      id: string;
      status: string;
      priority: string;
      unread_count: number;
      last_message_at: string | null;
      ai_intent: string | null;
      ai_temperature: string | null;
      contacts: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
    }>).map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] ?? null : c.contacts;
      return {
        id: c.id,
        status: c.status,
        priority: c.priority,
        unread_count: c.unread_count,
        last_message_at: c.last_message_at,
        ai_intent: c.ai_intent,
        ai_temperature: c.ai_temperature,
        contact_name: contact?.name ?? contact?.phone ?? null,
      };
    });

    return {
      result: items,
      record: {
        tool: 'list_conversations',
        summary: `${items.length} conversa${items.length === 1 ? '' : 's'} encontrada${items.length === 1 ? '' : 's'}`,
        result_count: items.length,
      },
    };
  }

  private async toolListTasks(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const limit = clampLimit(Number(input.limit), 15, 30);
    const mineOnly = input.mine_only !== false;

    let q = this.supabase.adminClient
      .from('tasks')
      .select(
        'id, title, task_type, priority, status, due_date, contact_id, deal_id, contact:contacts(name), deal:deals(title)',
      )
      .eq('org_id', ctx.orgId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(limit);

    if (input.status) q = q.eq('status', String(input.status));
    if (input.priority) q = q.eq('priority', String(input.priority));
    if (mineOnly) q = q.eq('assigned_to', ctx.userId);

    if (input.only_overdue === true) {
      q = q.in('status', ['pending', 'in_progress']).lt('due_date', new Date().toISOString());
    }
    if (input.only_today === true) {
      const startOfDay = new Date();
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(startOfDay);
      endOfDay.setHours(23, 59, 59, 999);
      q = q.gte('due_date', startOfDay.toISOString()).lte('due_date', endOfDay.toISOString());
    }

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    const items = ((data ?? []) as Array<{
      id: string;
      title: string;
      task_type: string;
      priority: string;
      status: string;
      due_date: string | null;
      contact_id: string | null;
      deal_id: string | null;
      contact: { name: string | null } | Array<{ name: string | null }> | null;
      deal: { title: string } | Array<{ title: string }> | null;
    }>).map((t) => {
      const contact = Array.isArray(t.contact) ? t.contact[0] ?? null : t.contact;
      const deal = Array.isArray(t.deal) ? t.deal[0] ?? null : t.deal;
      return {
        id: t.id,
        title: t.title,
        task_type: t.task_type,
        priority: t.priority,
        status: t.status,
        due_date: t.due_date,
        contact_name: contact?.name ?? null,
        deal_title: deal?.title ?? null,
      };
    });

    return {
      result: items,
      record: {
        tool: 'list_tasks',
        summary: `${items.length} tarefa${items.length === 1 ? '' : 's'}`,
        result_count: items.length,
      },
    };
  }

  private async toolAgentStats(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const userId = input.user_id ? String(input.user_id) : ctx.userId;
    const periodDays = Number(input.period_days) > 0 ? Math.min(Number(input.period_days), 365) : 30;
    const sinceIso = new Date(Date.now() - periodDays * 86_400_000).toISOString();

    const [wonResp, lostResp, openResp, completedTasksResp] = await Promise.all([
      this.supabase.adminClient
        .from('deals')
        .select('value', { count: 'exact' })
        .eq('org_id', ctx.orgId)
        .eq('assigned_to', userId)
        .gte('won_at', sinceIso)
        .not('won_at', 'is', null),
      this.supabase.adminClient
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('assigned_to', userId)
        .gte('lost_at', sinceIso)
        .not('lost_at', 'is', null),
      this.supabase.adminClient
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('assigned_to', userId)
        .is('won_at', null)
        .is('lost_at', null),
      this.supabase.adminClient
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', ctx.orgId)
        .eq('assigned_to', userId)
        .eq('status', 'completed')
        .gte('completed_at', sinceIso),
    ]);

    const wonCount = wonResp.count ?? 0;
    const lostCount = lostResp.count ?? 0;
    const openCount = openResp.count ?? 0;
    const tasksCompleted = completedTasksResp.count ?? 0;

    const wonValue = (wonResp.data ?? []).reduce(
      (acc: number, d: { value: number | null }) => acc + Number(d.value ?? 0),
      0,
    );

    const closedTotal = wonCount + lostCount;
    const winRate = closedTotal > 0 ? Math.round((wonCount / closedTotal) * 100) : null;

    return {
      result: {
        period_days: periodDays,
        deals_won: wonCount,
        deals_lost: lostCount,
        deals_open: openCount,
        won_value_brl: wonValue,
        win_rate_percent: winRate,
        tasks_completed: tasksCompleted,
      },
      record: {
        tool: 'get_agent_stats',
        summary: `${wonCount} ganhos · ${lostCount} perdidos · R$ ${wonValue.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} fechado em ${periodDays}d`,
      },
    };
  }

  private async toolCreateTask(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('title é obrigatório');

    const dto = {
      org_id: ctx.orgId,
      title,
      description: input.description ? String(input.description) : null,
      task_type: (input.task_type as string) ?? 'follow_up',
      priority: (input.priority as string) ?? 'normal',
      status: 'pending' as const,
      assigned_to: ctx.userId,
      contact_id: input.contact_id ? String(input.contact_id) : null,
      deal_id: input.deal_id ? String(input.deal_id) : null,
      due_date: input.due_date ? String(input.due_date) : null,
      created_by_ai: true,
      ai_context: 'Criada pelo Copiloto Comercial',
      created_by: ctx.userId,
    };

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .insert(dto)
      .select('id, title')
      .single();

    if (error || !data) throw new Error(error?.message ?? 'Falha ao criar tarefa');

    const created = data as { id: string; title: string };
    return {
      result: { id: created.id, title: created.title },
      record: {
        tool: 'create_task',
        summary: `Tarefa criada: ${created.title}`,
        resource_id: created.id,
        resource_kind: 'task',
      },
    };
  }

  private async toolCreateDeal(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('title é obrigatório');

    let pipelineId = input.pipeline_id ? String(input.pipeline_id) : null;
    if (!pipelineId) {
      const { data } = await this.supabase.adminClient
        .from('pipelines')
        .select('id')
        .eq('org_id', ctx.orgId)
        .eq('is_active', true)
        .order('position', { ascending: true })
        .limit(1)
        .maybeSingle();
      pipelineId = (data as { id: string } | null)?.id ?? null;
    }
    if (!pipelineId) throw new Error('Nenhum pipeline ativo encontrado');

    // Pega o primeiro stage normal (não won/lost)
    const { data: stage, error: stageError } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('pipeline_id', pipelineId)
      .eq('is_won', false)
      .eq('is_lost', false)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (stageError || !stage) {
      throw new Error('Pipeline sem stages ativas configuradas');
    }

    const dto = {
      org_id: ctx.orgId,
      title,
      pipeline_id: pipelineId,
      stage_id: (stage as { id: string }).id,
      contact_id: input.contact_id ? String(input.contact_id) : null,
      value: typeof input.value === 'number' ? input.value : 0,
      currency: 'BRL',
      assigned_to: ctx.userId,
      created_by: ctx.userId,
    };

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .insert(dto)
      .select('id, title')
      .single();

    if (error || !data) throw new Error(error?.message ?? 'Falha ao criar deal');

    const created = data as { id: string; title: string };
    return {
      result: { id: created.id, title: created.title },
      record: {
        tool: 'create_deal',
        summary: `Negócio criado: ${created.title}`,
        resource_id: created.id,
        resource_kind: 'deal',
      },
    };
  }

  // ────────────────────────────────────────────
  // Persistência
  // ────────────────────────────────────────────

  private async persistMessage(args: {
    orgId: string;
    userId: string;
    role: 'user' | 'assistant';
    content: string;
    toolCalls: ToolCallRecord[];
    costUsd: number;
    metadata?: Record<string, unknown>;
  }): Promise<{ id: string }> {
    const { data, error } = await this.supabase.adminClient
      .from('copilot_messages')
      .insert({
        org_id: args.orgId,
        user_id: args.userId,
        role: args.role,
        content: args.content,
        tool_calls: args.toolCalls,
        metadata: args.metadata ?? {},
        cost_usd: args.costUsd,
      })
      .select('id')
      .single();

    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao persistir mensagem');
    }
    return data as { id: string };
  }

  private async logAiInteraction(args: {
    orgId: string;
    userId: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    summary: string;
  }): Promise<void> {
    const cost = computeSonnetCost(args.inputTokens, args.outputTokens);
    const { error } = await this.supabase.adminClient.from('ai_interactions').insert({
      org_id: args.orgId,
      interaction_type: 'copilot',
      model: SONNET_MODEL_ID,
      provider: 'anthropic',
      input_tokens: args.inputTokens,
      output_tokens: args.outputTokens,
      cost_usd: cost,
      latency_ms: args.latencyMs,
      user_id: args.userId,
      result_summary: args.summary,
      metadata: {},
    });
    if (error) throw new Error(error.message);
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

interface ToolContext {
  orgId: string;
  userId: string;
}

function clampLimit(value: number, defaultValue: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return defaultValue;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function computeSonnetCost(input_tokens: number, output_tokens: number): number {
  const cost =
    (input_tokens * SONNET_PRICING.input_per_mtok_usd +
      output_tokens * SONNET_PRICING.output_per_mtok_usd) /
    1_000_000;
  return round6(cost);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
