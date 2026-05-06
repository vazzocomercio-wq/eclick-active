import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { LlmService } from '../../common/llm/llm.service';
import { computeCost } from '../../common/llm/llm-pricing';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LiveSourcesService } from '../knowledge/live-sources.service';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AppointmentTypesService } from '../appointments/appointment-types.service';
import { CalendarIntegrationsService } from '../calendar-integrations/calendar-integrations.service';
import { CalendlyService } from '../calendar-integrations/calendly.service';
import { SacTicketsService } from '../sac/sac-tickets.service';
import { SacAiService } from '../sac/sac-ai.service';
import { BridgeService } from '../bridge/bridge.service';
import { SocialContentsService } from '../social/social-contents.service';
import { SocialBrandsService } from '../social/social-brands.service';
import { SocialAiGeneratorService } from '../social/social-ai/social-ai-generator.service';
import { CatalogService } from '../whatsapp-commerce/catalog/catalog.service';
import { WhatsAppCartService } from '../whatsapp-commerce/cart/cart.service';
import { WhatsAppOrderService } from '../whatsapp-commerce/order/order.service';
import {
  COPILOT_SYSTEM_PROMPT,
  MAX_HISTORY_MESSAGES,
  MAX_TOOL_ITERATIONS,
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
  /** ID da row em ai_interactions — pra UI permitir feedback 👍/👎. Null se log falhou. */
  ai_interaction_id: string | null;
}

// ──────────────────────────────────────────────────────────
// Service
// ──────────────────────────────────────────────────────────

@Injectable()
export class CopilotService {
  private readonly logger = new Logger(CopilotService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly knowledge: KnowledgeService,
    private readonly liveSources: LiveSourcesService,
    private readonly persona: AiPersonaService,
    private readonly appointments: AppointmentsService,
    private readonly appointmentTypes: AppointmentTypesService,
    private readonly calendarIntegrations: CalendarIntegrationsService,
    private readonly calendly: CalendlyService,
    private readonly sacTickets: SacTicketsService,
    private readonly sacAi: SacAiService,
    private readonly bridge: BridgeService,
    private readonly socialContents: SocialContentsService,
    private readonly socialBrands: SocialBrandsService,
    private readonly socialAi: SocialAiGeneratorService,
    private readonly catalog: CatalogService,
    private readonly waCart: WhatsAppCartService,
    private readonly waOrders: WhatsAppOrderService,
  ) {}

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
    context?: { type?: CopilotContext['type']; id?: string },
  ): Promise<ProcessQueryResult> {
    const start = performance.now();

    // 1. Persiste user message imediatamente (idempotência via select-after).
    //    O contexto NÃO entra em `content` — apenas em `metadata` pra trace.
    const userMetadata =
      context?.type && context.type !== 'general'
        ? { context_type: context.type, context_id: context.id ?? null }
        : {};
    await this.persistMessage({
      orgId,
      userId,
      role: 'user',
      content: userMessage,
      toolCalls: [],
      costUsd: 0,
      metadata: userMetadata,
    });

    // 2. Carrega histórico (já inclui a user message recém-persistida)
    const history = await this.getHistory(orgId, userId);

    // 3. Monta messages para a API Anthropic
    const messages: Anthropic.MessageParam[] = history.map((h) => ({
      role: h.role,
      content: h.content,
    }));

    // 3a. Se houver contexto pra esse turn, busca a entidade e ANTEPÕE um
    //     preâmbulo "[CONTEXTO ATIVO: ...]" à última user message. Isso
    //     mantém o histórico persistido limpo e dá ao modelo a referência
    //     pra interpretar a pergunta sem ambiguidade.
    if (context?.type && context.type !== 'general' && context.id) {
      const summary = await this.loadContextSummary(orgId, context.type, context.id);
      const last = messages[messages.length - 1];
      if (summary && last && last.role === 'user' && typeof last.content === 'string') {
        messages[messages.length - 1] = {
          role: 'user',
          content: `[CONTEXTO ATIVO: ${summary}]\n\n${last.content}`,
        };
      }
    }

    // 4. Tool runner loop — system prompt = persona (se houver) + COPILOT_SYSTEM_PROMPT
    const personaDefault = await this.persona.getDefault(orgId).catch(() => null);
    const systemPrompt = personaDefault
      ? `${this.persona.buildSystemPrompt(personaDefault)}\n\n---\n\n${COPILOT_SYSTEM_PROMPT}`
      : COPILOT_SYSTEM_PROMPT;

    const ctx: ToolContext = { orgId, userId };
    const result = await this.runToolLoop(orgId, messages, ctx, systemPrompt);

    // 5. Loga ai_interactions ANTES de persistir o assistant message — assim
    //    o id da interação entra no metadata do copilot_messages e o
    //    histórico recarregado consegue exibir 👍/👎 nas mensagens passadas.
    const aiInteractionId = await this.logAiInteraction({
      orgId,
      userId,
      model: result.model,
      costUsd: result.costUsd,
      inputTokens: result.totalInputTokens,
      outputTokens: result.totalOutputTokens,
      latencyMs: Math.round(performance.now() - start),
      summary: result.reply.slice(0, 200),
    }).catch((err) => {
      this.logger.warn(
        `ai_interactions log failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });

    // 6. Persiste assistant message com ai_interaction_id no metadata
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
        ...(aiInteractionId ? { ai_interaction_id: aiInteractionId } : {}),
      },
    });

    return {
      reply: result.reply,
      tool_calls: result.toolCalls,
      cost_usd: result.costUsd,
      latency_ms: Math.round(performance.now() - start),
      assistant_message_id: assistant.id,
      ai_interaction_id: aiInteractionId,
    };
  }

  // ────────────────────────────────────────────
  // Tool runner — multi-turn loop
  // ────────────────────────────────────────────

  private async runToolLoop(
    orgId: string,
    initialMessages: Anthropic.MessageParam[],
    ctx: ToolContext,
    systemPrompt: string = COPILOT_SYSTEM_PROMPT,
  ): Promise<{
    reply: string;
    toolCalls: ToolCallRecord[];
    costUsd: number;
    iterations: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    model: string;
  }> {
    // Resolve cliente Anthropic + modelo da cred per-org. Se org configurou
    // outro provider, o LlmService faz fallback pro env (com warning).
    const { client, model } = await this.llm.getAnthropicClientForOrg(orgId);

    const messages = [...initialMessages];
    const toolCalls: ToolCallRecord[] = [];
    let totalCost = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let iterations = 0;

    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations += 1;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = (await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        tools: COPILOT_TOOLS,
        messages,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as Anthropic.Message;

      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      totalCost += computeCost(
        'anthropic',
        model,
        response.usage.input_tokens,
        response.usage.output_tokens,
      );

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
          model,
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
      model,
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
      case 'search_knowledge':
        return this.toolSearchKnowledge(input, ctx);
      case 'search_live_sources':
        return this.toolSearchLiveSources(input, ctx);
      case 'check_available_slots':
        return this.toolCheckAvailableSlots(input, ctx);
      case 'schedule_appointment':
        return this.toolScheduleAppointment(input, ctx);
      case 'list_sac_tickets':
        return this.toolListSacTickets(input, ctx);
      case 'get_sac_dashboard':
        return this.toolGetSacDashboard(input, ctx);
      case 'get_sac_performance':
        return this.toolGetSacPerformance(input, ctx);
      case 'check_order_status':
        return this.toolCheckOrderStatus(input, ctx);
      case 'generate_social_content':
        return this.toolGenerateSocialContent(input, ctx);
      case 'list_pending_social_content':
        return this.toolListPendingSocialContent(input, ctx);
      case 'get_social_dashboard':
        return this.toolGetSocialDashboard(input, ctx);
      case 'schedule_social_content':
        return this.toolScheduleSocialContent(input, ctx);
      case 'search_products':
        return this.toolSearchProducts(input, ctx);
      case 'get_product_details':
        return this.toolGetProductDetails(input, ctx);
      case 'manage_cart':
        return this.toolManageCart(input, ctx);
      case 'apply_coupon':
        return this.toolApplyCoupon(input, ctx);
      case 'checkout':
        return this.toolCheckout(input, ctx);
      case 'check_whatsapp_order':
        return this.toolCheckWhatsAppOrder(input, ctx);
      case 'recommend_products':
        return this.toolRecommendProducts(input, ctx);
      case 'send_scheduling_link':
        return this.toolSendSchedulingLink(input, ctx);
      default:
        throw new Error(`Tool desconhecida: ${name}`);
    }
  }

  private async toolCheckAvailableSlots(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const date =
      typeof input.date === 'string' && input.date.length > 0
        ? input.date
        : new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

    const slots = await this.appointments.getAvailableSlots(ctx.orgId, {
      date,
      ...(input.agent_id ? { agent_id: String(input.agent_id) } : {}),
      ...(input.type_id ? { type_id: String(input.type_id) } : {}),
    });
    const top = slots.slice(0, 12);

    return {
      result: {
        date,
        slots_count: slots.length,
        slots: top.map((s) => ({
          start_time: s.start_time,
          end_time: s.end_time,
          agent: s.agent_name ?? 'Agente',
        })),
      },
      record: {
        tool: 'check_available_slots',
        summary: `${slots.length} horário${slots.length === 1 ? '' : 's'} disponível${slots.length === 1 ? '' : 'eis'} em ${date}`,
        result_count: slots.length,
      },
    };
  }

  private async toolSendSchedulingLink(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    // Resolve member_id do user que falou com copilot
    const { data: memberRow } = await this.supabase.adminClient
      .from('org_members')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const memberId = (memberRow as { id: string } | null)?.id ?? null;
    if (!memberId) {
      return {
        result: { error: 'Membro não encontrado' },
        record: { tool: 'send_scheduling_link', summary: 'Sem member_id' },
      };
    }

    const integration = await this.calendarIntegrations.findActiveForAgent(
      ctx.orgId,
      memberId,
      'calendly',
    );
    if (!integration) {
      return {
        result: {
          error: 'Sem Calendly conectado',
          hint: 'Conecte em Configurações → Agendamento → Integrações',
        },
        record: { tool: 'send_scheduling_link', summary: 'Calendly não conectado' },
      };
    }

    const eventTypeUri = typeof input.event_type_uri === 'string' ? input.event_type_uri : undefined;
    const link = await this.calendly.getSchedulingLink(integration.id, eventTypeUri);
    if (!link) {
      return {
        result: { error: 'Link não encontrado' },
        record: { tool: 'send_scheduling_link', summary: 'Sem link disponível' },
      };
    }

    return {
      result: {
        scheduling_url: link,
        provider: 'calendly',
      },
      record: {
        tool: 'send_scheduling_link',
        summary: `Link Calendly: ${link}`,
      },
    };
  }

  private async toolScheduleAppointment(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const title = String(input.title ?? '').trim();
    if (!title) throw new Error('title é obrigatório');
    const startStr = String(input.start_time ?? '').trim();
    if (!startStr) throw new Error('start_time é obrigatório');

    let durationMinutes = Number(input.duration_minutes);
    if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
      if (input.appointment_type_id) {
        const t = await this.appointmentTypes
          .findById(ctx.orgId, String(input.appointment_type_id))
          .catch(() => null);
        durationMinutes = t?.duration_minutes ?? 30;
      } else {
        durationMinutes = 30;
      }
    }

    const start = new Date(startStr);
    const end = new Date(start.getTime() + durationMinutes * 60_000);

    const { data: memberRow } = await this.supabase.adminClient
      .from('org_members')
      .select('id')
      .eq('org_id', ctx.orgId)
      .eq('user_id', ctx.userId)
      .maybeSingle();
    const memberId = (memberRow as { id: string } | null)?.id ?? null;

    const appt = await this.appointments.create(
      ctx.orgId,
      {
        title,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        ...(input.contact_id ? { contact_id: String(input.contact_id) } : {}),
        ...(input.deal_id ? { deal_id: String(input.deal_id) } : {}),
        ...(input.appointment_type_id
          ? { appointment_type_id: String(input.appointment_type_id) }
          : {}),
        ...(memberId ? { assigned_to: memberId } : {}),
        ...(input.notes ? { notes: String(input.notes) } : {}),
      },
      true, // created_by_ai
    );

    return {
      result: {
        id: appt.id,
        title: appt.title,
        start_time: appt.start_time,
        end_time: appt.end_time,
      },
      record: {
        tool: 'schedule_appointment',
        summary: `Agendado: ${appt.title} em ${new Date(appt.start_time).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}`,
        resource_id: appt.id,
      },
    };
  }

  private async toolSearchLiveSources(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const query = String(input.query ?? '').trim();
    if (!query) throw new Error('query é obrigatório');

    const live = await this.liveSources.fetchLiveContent(ctx.orgId, query);
    if (!live || live.sources_used.length === 0) {
      return {
        result: { content: null, sources_used: [], note: 'Nenhuma fonte live cadastrada ou relevante pra essa query.' },
        record: {
          tool: 'search_live_sources',
          summary: 'Nenhuma fonte live relevante',
          result_count: 0,
        },
      };
    }

    return {
      result: {
        content: live.content.length > 4000 ? `${live.content.slice(0, 4000)}…` : live.content,
        sources_used: live.sources_used,
      },
      record: {
        tool: 'search_live_sources',
        summary: `Consultou ${live.sources_used.length} fonte${live.sources_used.length === 1 ? '' : 's'} live: ${live.sources_used.map((s) => s.name).join(', ')}`,
        result_count: live.sources_used.length,
      },
    };
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

  private async toolSearchKnowledge(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const query = String(input.query ?? '').trim();
    if (!query) throw new Error('query é obrigatório');
    const limit = clampLimit(Number(input.limit), 5, 10);

    const hits = await this.knowledge.searchSemantic(ctx.orgId, query, limit);

    return {
      result: hits.map((h) => ({
        id: h.id,
        title: h.title,
        category: h.category,
        // Trunca content para não estourar o contexto do modelo
        content: h.content.length > 1500 ? `${h.content.slice(0, 1500)}…` : h.content,
        similarity: Math.round(h.similarity * 100) / 100,
      })),
      record: {
        tool: 'search_knowledge',
        summary: `${hits.length} documento${hits.length === 1 ? '' : 's'} relevante${hits.length === 1 ? '' : 's'}`,
        result_count: hits.length,
      },
    };
  }

  // ────────────────────────────────────────────
  // Contexto contextual (deal/contact/conversation)
  // ────────────────────────────────────────────

  /**
   * Resolve uma entidade pelo type+id e retorna uma frase resumindo o seu
   * estado atual — pra dar ao modelo o contexto certo sem ele precisar
   * chamar tool. Retorna `null` se não encontrar (o turn segue sem contexto).
   */
  private async loadContextSummary(
    orgId: string,
    type: 'deal' | 'contact' | 'conversation',
    id: string,
  ): Promise<string | null> {
    if (type === 'deal') {
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select(
          'id, title, value, currency, ai_score, ai_risk, ai_close_probability, ai_next_action, contact:contacts(name, temperature), stage:pipeline_stages(name)',
        )
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      const d = data as {
        title: string;
        value: number | null;
        currency: string;
        ai_score: number;
        ai_risk: string | null;
        ai_close_probability: number | null;
        contact: { name: string | null; temperature: string | null } | Array<{ name: string | null; temperature: string | null }> | null;
        stage: { name: string } | Array<{ name: string }> | null;
      };
      const contact = Array.isArray(d.contact) ? d.contact[0] ?? null : d.contact;
      const stage = Array.isArray(d.stage) ? d.stage[0] ?? null : d.stage;
      const valueStr =
        d.value !== null && d.value > 0
          ? new Intl.NumberFormat('pt-BR', {
              style: 'currency',
              currency: d.currency || 'BRL',
              maximumFractionDigits: 0,
            }).format(d.value)
          : null;
      const parts = [
        `deal "${d.title}"`,
        contact?.name ? `cliente ${contact.name}` : null,
        valueStr,
        stage?.name ? `stage "${stage.name}"` : null,
        contact?.temperature ? `temperatura ${contact.temperature}` : null,
        d.ai_risk ? `risco ${d.ai_risk}` : null,
        typeof d.ai_score === 'number' ? `score ${d.ai_score}/100` : null,
        typeof d.ai_close_probability === 'number'
          ? `prob fechamento ${d.ai_close_probability}%`
          : null,
      ].filter(Boolean);
      return `Estou analisando o ${parts.join(', ')}.`;
    }

    if (type === 'contact') {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name, phone, temperature, score, ai_summary, tags')
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      const c = data as {
        name: string | null;
        phone: string | null;
        temperature: string | null;
        score: number;
        ai_summary: string | null;
        tags: string[];
      };
      const parts = [
        `contato ${c.name ?? c.phone ?? '(sem nome)'}`,
        typeof c.score === 'number' ? `score ${c.score}` : null,
        c.temperature ? `temperatura ${c.temperature}` : null,
        c.tags && c.tags.length > 0 ? `tags ${c.tags.slice(0, 3).join(', ')}` : null,
      ].filter(Boolean);
      const head = `Estou analisando o ${parts.join(', ')}.`;
      return c.ai_summary ? `${head} Resumo IA: ${c.ai_summary}` : head;
    }

    if (type === 'conversation') {
      const { data } = await this.supabase.adminClient
        .from('conversations')
        .select(
          'status, channel_type, ai_intent, ai_temperature, ai_summary, contacts:contact_id(name, phone)',
        )
        .eq('org_id', orgId)
        .eq('id', id)
        .maybeSingle();
      if (!data) return null;
      const c = data as {
        status: string;
        channel_type: string;
        ai_intent: string | null;
        ai_temperature: string | null;
        ai_summary: string | null;
        contacts: { name: string | null; phone: string | null } | Array<{ name: string | null; phone: string | null }> | null;
      };
      const contact = Array.isArray(c.contacts) ? c.contacts[0] ?? null : c.contacts;
      const parts = [
        `conversa via ${c.channel_type}`,
        contact?.name ? `com ${contact.name}` : contact?.phone ? `com ${contact.phone}` : null,
        c.ai_temperature ? `temperatura ${c.ai_temperature}` : null,
        c.ai_intent ? `intent ${c.ai_intent}` : null,
        `status ${c.status}`,
      ].filter(Boolean);
      const head = `Estou analisando a ${parts.join(', ')}.`;
      return c.ai_summary ? `${head} Resumo IA: ${c.ai_summary}` : head;
    }

    return null;
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
    model: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    summary: string;
  }): Promise<string | null> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .insert({
        org_id: args.orgId,
        interaction_type: 'copilot',
        model: args.model,
        provider: 'anthropic',
        input_tokens: args.inputTokens,
        output_tokens: args.outputTokens,
        cost_usd: args.costUsd,
        latency_ms: args.latencyMs,
        user_id: args.userId,
        result_summary: args.summary,
        metadata: {},
      })
      .select('id')
      .single();
    if (error) throw new Error(error.message);
    return (data as { id: string } | null)?.id ?? null;
  }

  // ────────────────────────────────────────────
  // SAC tools
  // ────────────────────────────────────────────

  private async toolListSacTickets(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const limit = clampLimit(Number(input.limit ?? 0), 10, 25);
    const filters: Parameters<typeof this.sacTickets.findAll>[1] = {
      page_size: limit,
    };
    if (typeof input.priority === 'string') {
      filters.priority = input.priority as never;
    }
    if (typeof input.status === 'string') {
      filters.status = input.status as never;
    } else {
      // Default: tickets abertos
      filters.status = ['new', 'in_progress', 'reopened', 'waiting_customer', 'waiting_internal'] as never;
    }
    if (typeof input.category === 'string') {
      filters.category = input.category as never;
    }
    if (typeof input.sla_breached === 'boolean') {
      filters.sla_breached = input.sla_breached;
    }

    const { rows, total } = await this.sacTickets.findAll(ctx.orgId, filters);
    const summary =
      rows.length === 0
        ? 'Nenhum ticket encontrado'
        : `${rows.length} ticket(s) (de ${total} total)`;
    return {
      result: {
        total,
        tickets: rows.map((t) => ({
          id: t.id,
          number: t.ticket_number,
          status: t.status,
          priority: t.priority,
          category: t.category,
          summary: t.ai_summary,
          sla_deadline: t.sla_deadline_at,
          sla_breached: t.sla_breached,
          reputation_risk: t.reputation_risk_level,
          source: t.source_channel,
          order_id: t.order_marketplace_id,
          created_at: t.created_at,
        })),
      },
      record: { tool: 'list_sac_tickets', summary },
    };
  }

  private async toolGetSacDashboard(
    _input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const counts = await this.sacTickets.getDashboardCounts(ctx.orgId);
    return {
      result: counts,
      record: {
        tool: 'get_sac_dashboard',
        summary: `${counts.total_open} aberto(s), ${counts.critical} crítico(s), ${counts.sla_breached} SLA vencido(s)`,
      },
    };
  }

  private async toolGetSacPerformance(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const period =
      input.period === 'today' || input.period === 'month' ? input.period : 'week';
    const analysis = await this.sacAi.analyzePerformance(ctx.orgId, period as 'today' | 'week' | 'month');
    return {
      result: analysis,
      record: {
        tool: 'get_sac_performance',
        summary: `Diagnóstico SAC (${period}) gerado`,
      },
    };
  }

  // ────────────────────────────────────────────
  // Social tools
  // ────────────────────────────────────────────

  private async toolGenerateSocialContent(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const theme = typeof input.theme === 'string' ? input.theme.trim() : '';
    if (!theme) {
      return {
        result: { error: 'theme é obrigatório' },
        record: { tool: 'generate_social_content', summary: 'Tema vazio' },
      };
    }
    const type = input.type === 'carousel' ? 'carousel' : 'post';

    let brandId = typeof input.brand_id === 'string' ? input.brand_id : '';
    if (!brandId) {
      const brands = await this.socialBrands.findAll(ctx.orgId);
      const active = brands.find((b) => b.is_active);
      if (!active) {
        return {
          result: { error: 'Nenhuma marca ativa configurada' },
          record: {
            tool: 'generate_social_content',
            summary: 'Sem marca configurada',
          },
        };
      }
      brandId = active.id;
    }

    const pillar =
      typeof input.pillar === 'string' ? (input.pillar as never) : 'educational';
    const slideCount =
      typeof input.slide_count === 'number' ? input.slide_count : 7;

    try {
      const content =
        type === 'carousel'
          ? await this.socialAi.createAndGenerateCarousel(ctx.orgId, {
              brand_id: brandId,
              theme,
              pillar,
              slide_count: slideCount,
            })
          : await this.socialAi.createAndGeneratePost(ctx.orgId, {
              brand_id: brandId,
              theme,
              pillar,
            });
      return {
        result: {
          content_id: content.id,
          content_type: content.content_type,
          status: content.status,
          caption_preview: content.caption?.slice(0, 160),
          cover_image_url: content.cover_image_url,
        },
        record: {
          tool: 'generate_social_content',
          summary: `${type === 'carousel' ? 'Carrossel' : 'Post'} gerado: "${theme.slice(0, 40)}"`,
          resource_id: content.id,
        },
      };
    } catch (err) {
      return {
        result: { error: err instanceof Error ? err.message : String(err) },
        record: {
          tool: 'generate_social_content',
          summary: 'Falha ao gerar conteúdo',
        },
      };
    }
  }

  private async toolListPendingSocialContent(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const limit = clampLimit(Number(input.limit ?? 0), 10, 25);
    const { rows, total } = await this.socialContents.findAll(ctx.orgId, {
      status: 'pending_approval',
      page_size: limit,
    });
    return {
      result: {
        total,
        contents: rows.map((c) => ({
          id: c.id,
          type: c.content_type,
          title: c.title,
          caption_preview: c.caption?.slice(0, 100),
          pillar: c.pillar,
          created_at: c.created_at,
        })),
      },
      record: {
        tool: 'list_pending_social_content',
        summary: `${rows.length} conteúdo(s) aguardando aprovação`,
      },
    };
  }

  private async toolGetSocialDashboard(
    _input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const dash = await this.socialContents.getDashboard(ctx.orgId);
    return {
      result: dash,
      record: {
        tool: 'get_social_dashboard',
        summary: `${dash.pending_approval} pendente(s), ${dash.scheduled_next_7d} agendado(s) próx 7d`,
      },
    };
  }

  private async toolScheduleSocialContent(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const contentId = typeof input.content_id === 'string' ? input.content_id : '';
    const scheduledFor =
      typeof input.scheduled_for === 'string' ? input.scheduled_for : '';
    if (!contentId || !scheduledFor) {
      return {
        result: { error: 'content_id e scheduled_for são obrigatórios' },
        record: {
          tool: 'schedule_social_content',
          summary: 'Argumentos faltando',
        },
      };
    }
    try {
      const c = await this.socialContents.schedule(ctx.orgId, contentId, {
        scheduled_for: scheduledFor,
      });
      return {
        result: { content_id: c.id, scheduled_for: c.scheduled_for },
        record: {
          tool: 'schedule_social_content',
          summary: `Agendado pra ${new Date(scheduledFor).toLocaleString('pt-BR')}`,
          resource_id: c.id,
        },
      };
    } catch (err) {
      return {
        result: { error: err instanceof Error ? err.message : String(err) },
        record: {
          tool: 'schedule_social_content',
          summary: 'Falha ao agendar',
        },
      };
    }
  }

  private async toolCheckOrderStatus(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const query = typeof input.query === 'string' ? input.query.trim() : '';
    if (!query) {
      return {
        result: { error: 'query é obrigatório' },
        record: { tool: 'check_order_status', summary: 'Query vazia' },
      };
    }
    const order = await this.bridge.getOrderByQuery(ctx.orgId, query);
    if (!order) {
      return {
        result: { found: false, query },
        record: {
          tool: 'check_order_status',
          summary: `Pedido "${query}" não encontrado no SaaS`,
        },
      };
    }
    return {
      result: {
        found: true,
        marketplace: order.marketplace,
        marketplace_order_id: order.marketplace_order_id,
        status: order.status,
        shipping_status: order.shipping_status,
        shipping_tracking: order.shipping_tracking_number,
        shipping_estimated_delivery: order.shipping_estimated_delivery,
        total_amount: order.total_amount,
        buyer_phone: order.buyer_phone,
        buyer_email: order.buyer_email,
      },
      record: {
        tool: 'check_order_status',
        summary: `${order.marketplace ?? 'Pedido'} #${order.marketplace_order_id ?? '?'}: ${order.shipping_status ?? '?'}`,
      },
    };
  }

  // ────────────────────────────────────────────
  // WhatsApp Commerce tools
  // ────────────────────────────────────────────

  private async toolSearchProducts(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const products = await this.catalog.list(ctx.orgId, {
      query: typeof input.query === 'string' ? input.query : undefined,
      category: typeof input.category === 'string' ? input.category : undefined,
      min_price: typeof input.min_price === 'number' ? input.min_price : undefined,
      max_price: typeof input.max_price === 'number' ? input.max_price : undefined,
      in_stock_only: input.in_stock_only !== false,
      limit: clampLimit(Number(input.limit ?? 0), 5, 25),
    });
    return {
      result: {
        total_found: products.length,
        products: products.map((p) => ({
          id: p.product_id,
          name: p.name,
          price: p.price,
          in_stock: p.in_stock,
          stock: p.stock,
          short_description: p.short_description ?? p.description?.slice(0, 200),
          thumbnail: p.thumbnail_url,
          brand: p.brand,
          differentials: p.differentials,
          bullets: (p.bullets ?? []).slice(0, 3),
        })),
      },
      record: {
        tool: 'search_products',
        summary: `${products.length} produto(s) encontrado(s)`,
      },
    };
  }

  private async toolGetProductDetails(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const id = typeof input.product_id === 'string' ? input.product_id : '';
    if (!id) {
      return {
        result: { error: 'product_id obrigatório' },
        record: { tool: 'get_product_details', summary: 'product_id vazio' },
      };
    }
    const product = await this.catalog.getById(ctx.orgId, id);
    if (!product) {
      return {
        result: { found: false },
        record: { tool: 'get_product_details', summary: 'Produto não encontrado' },
      };
    }
    const config = await this.catalog.getConfig(ctx.orgId, id);
    return {
      result: {
        ...product,
        whatsapp_price: config?.whatsapp_price_override ?? product.price,
        can_negotiate: config?.allow_negotiation ?? false,
        min_quantity: config?.min_quantity_per_order ?? 1,
        max_quantity: config?.max_quantity_per_order ?? 10,
      },
      record: {
        tool: 'get_product_details',
        summary: `${product.name} — R$ ${product.price}`,
      },
    };
  }

  private async toolManageCart(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const contactId = typeof input.contact_id === 'string' ? input.contact_id : '';
    if (!contactId) {
      return {
        result: { error: 'contact_id obrigatório (passe o UUID do contato)' },
        record: { tool: 'manage_cart', summary: 'contact_id ausente' },
      };
    }
    const action = (input.action as string) ?? 'view';
    const cart = await this.waCart.getOrCreateCart(ctx.orgId, contactId);

    switch (action) {
      case 'view':
        return {
          result: { cart, message: this.waCart.formatForWhatsApp(cart) },
          record: {
            tool: 'manage_cart',
            summary: `${cart.items.length} item(s), R$ ${cart.total.toFixed(2)}`,
          },
        };
      case 'add': {
        const productId =
          typeof input.product_id === 'string' ? input.product_id : '';
        const product = productId
          ? await this.catalog.getById(ctx.orgId, productId)
          : null;
        if (!product) {
          return {
            result: { error: 'product_id inválido' },
            record: { tool: 'manage_cart', summary: 'Produto não encontrado' },
          };
        }
        if (!product.in_stock) {
          return {
            result: { error: 'Produto sem estoque', product },
            record: { tool: 'manage_cart', summary: 'Sem estoque' },
          };
        }
        const updated = await this.waCart.addItem(ctx.orgId, cart.id, {
          product_id: product.product_id,
          name: product.name,
          sku: product.sku,
          quantity: Math.max(1, Number(input.quantity ?? 1)),
          unit_price: product.price,
          thumbnail_url: product.thumbnail_url,
        });
        await this.catalog.incrementMetric(
          ctx.orgId,
          product.product_id,
          'added_to_cart',
        );
        return {
          result: { cart: updated, message: this.waCart.formatForWhatsApp(updated) },
          record: {
            tool: 'manage_cart',
            summary: `+ ${product.name}`,
            resource_id: cart.id,
          },
        };
      }
      case 'remove': {
        const productId =
          typeof input.product_id === 'string' ? input.product_id : '';
        if (!productId) {
          return {
            result: { error: 'product_id obrigatório pra remove' },
            record: { tool: 'manage_cart', summary: 'product_id ausente' },
          };
        }
        const updated = await this.waCart.removeItem(ctx.orgId, cart.id, productId);
        return {
          result: { cart: updated, message: this.waCart.formatForWhatsApp(updated) },
          record: { tool: 'manage_cart', summary: 'Item removido' },
        };
      }
      case 'update_quantity': {
        const productId =
          typeof input.product_id === 'string' ? input.product_id : '';
        const qty = Number(input.quantity ?? 1);
        if (!productId) {
          return {
            result: { error: 'product_id obrigatório' },
            record: { tool: 'manage_cart', summary: 'product_id ausente' },
          };
        }
        const updated = await this.waCart.updateQuantity(
          ctx.orgId,
          cart.id,
          productId,
          qty,
        );
        return {
          result: { cart: updated, message: this.waCart.formatForWhatsApp(updated) },
          record: { tool: 'manage_cart', summary: `Quantidade → ${qty}` },
        };
      }
      case 'clear': {
        const updated = await this.waCart.clear(ctx.orgId, cart.id);
        return {
          result: { cart: updated, message: '🛒 Carrinho esvaziado' },
          record: { tool: 'manage_cart', summary: 'Carrinho limpo' },
        };
      }
      default:
        return {
          result: { error: 'action inválida' },
          record: { tool: 'manage_cart', summary: `Action ${action} desconhecida` },
        };
    }
  }

  private async toolApplyCoupon(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const contactId = typeof input.contact_id === 'string' ? input.contact_id : '';
    const code =
      typeof input.coupon_code === 'string' ? input.coupon_code.toUpperCase() : '';
    if (!contactId || !code) {
      return {
        result: { error: 'contact_id e coupon_code obrigatórios' },
        record: { tool: 'apply_coupon', summary: 'Argumentos ausentes' },
      };
    }
    const cart = await this.waCart.getOrCreateCart(ctx.orgId, contactId);
    // MVP: lookup simples no settings.recovery_coupon_code; expandir
    // depois pra tabela de cupons própria.
    // Por ora aceita qualquer código com 10% de desconto fixo se não tiver
    // sistema de cupons na org.
    const discount = +(cart.subtotal * 0.1).toFixed(2);
    const updated = await this.waCart.applyCoupon(ctx.orgId, cart.id, code, discount);
    return {
      result: {
        cart: updated,
        applied_discount: discount,
        message: `Cupom *${code}* aplicado! Desconto: R$ ${discount.toFixed(2)}`,
      },
      record: {
        tool: 'apply_coupon',
        summary: `${code} → -R$ ${discount.toFixed(2)}`,
      },
    };
  }

  private async toolCheckout(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const contactId = typeof input.contact_id === 'string' ? input.contact_id : '';
    const paymentMethod =
      typeof input.payment_method === 'string' ? input.payment_method : 'pix';
    if (!contactId) {
      return {
        result: { error: 'contact_id obrigatório' },
        record: { tool: 'checkout', summary: 'contact_id ausente' },
      };
    }
    const cart = await this.waCart.getOrCreateCart(ctx.orgId, contactId);
    if (cart.items.length === 0) {
      return {
        result: { error: 'Carrinho vazio' },
        record: { tool: 'checkout', summary: 'Carrinho vazio' },
      };
    }
    try {
      const { order, payment_link } = await this.waOrders.createFromCart(ctx.orgId, {
        cart_id: cart.id,
        payment_method: paymentMethod as never,
        shipping_address: input.shipping_zip
          ? { zip: String(input.shipping_zip) }
          : undefined,
        customer_notes:
          typeof input.customer_notes === 'string'
            ? input.customer_notes
            : undefined,
      });
      return {
        result: {
          order_number: order.display_number,
          total: order.total,
          payment_method: order.payment_method,
          payment_link: payment_link?.url,
          pix_copy_paste: payment_link?.pix_copy_paste,
        },
        record: {
          tool: 'checkout',
          summary: `Pedido ${order.display_number} R$ ${order.total.toFixed(2)}`,
          resource_id: order.id,
        },
      };
    } catch (err) {
      return {
        result: { error: err instanceof Error ? err.message : String(err) },
        record: { tool: 'checkout', summary: 'Falha no checkout' },
      };
    }
  }

  private async toolCheckWhatsAppOrder(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const display =
      typeof input.display_number === 'string' ? input.display_number : '';
    if (!display) {
      return {
        result: { error: 'display_number obrigatório' },
        record: { tool: 'check_whatsapp_order', summary: 'display_number ausente' },
      };
    }
    const order = await this.waOrders.findByDisplayNumber(ctx.orgId, display);
    if (!order) {
      return {
        result: { found: false, display_number: display },
        record: {
          tool: 'check_whatsapp_order',
          summary: `${display} não encontrado`,
        },
      };
    }
    return {
      result: {
        order_number: order.display_number,
        status: order.status,
        payment_status: order.payment_status,
        shipping_status: order.shipping_status,
        tracking_code: order.tracking_code,
        total: order.total,
        created_at: order.created_at,
        paid_at: order.paid_at,
        shipped_at: order.shipped_at,
        delivered_at: order.delivered_at,
      },
      record: {
        tool: 'check_whatsapp_order',
        summary: `${order.display_number}: ${order.status}/${order.payment_status}`,
        resource_id: order.id,
      },
    };
  }

  private async toolRecommendProducts(
    input: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<{ result: unknown; record: ToolCallRecord }> {
    const desc =
      typeof input.context_description === 'string'
        ? input.context_description
        : '';
    if (!desc) {
      return {
        result: { error: 'context_description obrigatório' },
        record: { tool: 'recommend_products', summary: 'Sem contexto' },
      };
    }
    const exclude = Array.isArray(input.exclude_product_ids)
      ? (input.exclude_product_ids as string[])
      : [];
    const products = await this.catalog.list(ctx.orgId, {
      query: desc,
      max_price: typeof input.budget_max === 'number' ? input.budget_max : undefined,
      in_stock_only: true,
      limit: 5,
    });
    const filtered = products.filter((p) => !exclude.includes(p.product_id));
    return {
      result: {
        recommendations: filtered.slice(0, 3).map((p) => ({
          id: p.product_id,
          name: p.name,
          price: p.price,
          short_description: p.short_description ?? p.description?.slice(0, 200),
          thumbnail: p.thumbnail_url,
          why: 'Produto relevante baseado na descrição da necessidade',
        })),
      },
      record: {
        tool: 'recommend_products',
        summary: `${filtered.slice(0, 3).length} recomendação(ões)`,
      },
    };
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

interface ToolContext {
  orgId: string;
  userId: string;
}

export type CopilotContext = {
  type: 'deal' | 'contact' | 'conversation' | 'general';
  id?: string;
};

function clampLimit(value: number, defaultValue: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return defaultValue;
  return Math.min(Math.max(1, Math.floor(value)), max);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
