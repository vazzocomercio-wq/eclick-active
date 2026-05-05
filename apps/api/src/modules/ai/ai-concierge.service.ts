import { Injectable, Logger } from '@nestjs/common';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import type {
  AiAgentPersona,
  AiPersonaTone,
  ContactTemperature,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import { TagsService } from '../tags/tags.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { EventsGateway } from '../../gateways/events.gateway';
import type {
  AvailabilitySlot,
  TagDefinition,
} from '@eclick-active/shared';

const SONNET_MODEL_ID = 'claude-sonnet-4-6';
const HISTORY_MAX_MESSAGES = 6;

/** Limite de delay por humanização — evita persona com delay maluco travar request */
const MAX_DELAY_MS = 30_000;

/** Pricing Sonnet 4.6 (USD por milhão de tokens) — pra calcular custo log */
const SONNET_INPUT_PER_MTOK = 3.0;
const SONNET_OUTPUT_PER_MTOK = 15.0;

type ConciergeState =
  | 'idle'
  | 'awaiting_response'
  | 'awaiting_slot_choice'
  | 'routed';

/** Slot armazenado em conversation.metadata.scheduling.offered_slots — versão
 *  serializada do AvailabilitySlot pra facilitar parsing depois. */
interface OfferedSlot {
  index: number;
  start_time: string;
  end_time: string;
  agent_id: string;
  agent_name: string | null;
  duration_minutes: number;
}

interface SchedulingMetadata {
  /** Slots oferecidos ao lead na última proposta. */
  offered_slots: OfferedSlot[];
  /** Specialty (lower-case) usada pra filtrar agentes. Null = todos. */
  specialty: string | null;
  /** ISO timestamp de quando a proposta foi enviada. */
  proposed_at: string;
  /** Quantas vezes a IA pediu pro cliente escolher (cap 3). */
  retries: number;
  /** Mensagem original que disparou a oferta — pra contexto se ele tentar mudar. */
  origin_message: string;
}

/** Limite de re-perguntas quando lead não responde com número claro antes
 *  de transferir pro humano. Evita IA ficar perguntando "1, 2 ou 3?" infinito. */
const MAX_SLOT_CHOICE_RETRIES = 3;
/** Quantos slots mostrar de uma vez no WhatsApp. Mais que 3 polui a msg. */
const SLOT_OPTIONS_TO_SHOW = 3;

interface ConciergeSettings {
  enabled: boolean;
  auto_reply: boolean;
  send_bridge_message: boolean;
  business_context: string;
}

interface PipelineWithStages {
  id: string;
  name: string;
  description: string | null;
  is_default: boolean;
  stages: Array<{
    id: string;
    name: string;
    description: string | null;
    position: number;
    is_won: boolean;
    is_lost: boolean;
  }>;
}

/**
 * Limite de turnos de qualificação antes de forçar roteamento. Evita
 * loop infinito caso a IA fique pedindo info que o cliente não responde.
 */
const MAX_QUALIFYING_TURNS = 6;

interface RouteDecision {
  /**
   * Se true, ainda falta info pra qualificar o lead — IA gerou
   * `next_question` em vez de pipeline+stage. handleRoute vai enviar
   * essa pergunta, incrementar contador e manter state em
   * awaiting_response (loop continua).
   *
   * Se false, IA tem confiança pra rotear: pipeline_id, stage_id,
   * temperature e intent_label são preenchidos.
   */
  needs_more_info: boolean;
  /** Próxima pergunta natural a fazer (só preenchido quando needs_more_info=true). */
  next_question: string | null;
  /** ID do pipeline escolhido (preenchido quando needs_more_info=false). */
  pipeline_id: string | null;
  /** ID do stage escolhido (preenchido quando needs_more_info=false). */
  stage_id: string | null;
  intent_label: string | null;
  temperature: ContactTemperature | null;
  bridge_message: string | null;
  reasoning: string;
  /**
   * Tags semânticas curtas extraídas do qualifying — viram tags
   * estáveis no deal e no contato. Ex: ['NOVO_PACIENTE',
   * 'TRATAMENTO_INFUSAO', 'CONVENIO_GAMA']. Só preenchidas quando
   * needs_more_info=false (no momento do route).
   */
  tags: string[];
  /**
   * Quando o lead pediu agendamento, qual specialty/serviço a IA
   * detectou. Texto livre por nicho (ex: "nutricionista", "corte",
   * "motor", "vendas"). Lower-case. Null se não conseguiu extrair —
   * Concierge propõe slots de qualquer agente nesse caso. Só
   * preenchido quando AGENDAMENTO_SOLICITADO está em tags.
   */
  specialty_guess: string | null;
  /** Stats da chamada IA pra logar em ai_interactions */
  _usage?: {
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
  };
}

/**
 * AI Concierge — primeira camada de inteligência conversacional.
 *
 * Em cada mensagem inbound (chamado pelo `processInbound`), decide se:
 *   1. É a primeira interação → manda saudação personalizada com pergunta
 *      de sondagem (usa `persona.greeting_message` se preenchido, ou IA
 *      gera no tom da persona).
 *   2. O cliente respondeu à saudação → IA classifica a resposta e
 *      escolhe DINAMICAMENTE qual pipeline + stage encaixa o lead,
 *      considerando os pipelines da org (com descrições editáveis) e o
 *      `business_context` configurado pela org.
 *   3. Já roteou → não faz nada (deixa fluxo regular: classify + suggest).
 *
 * Estado é persistido em `conversations.metadata.concierge_state`.
 *
 * Toggles:
 *   - `settings.ai_concierge.enabled` (default false): liga o módulo
 *   - `settings.ai_concierge.auto_reply` (default false): envia respostas
 *      automaticamente. Se off, o concierge não dispara nada (modo silent).
 *   - `settings.ai_concierge.send_bridge_message` (default true): se a IA
 *      gerar uma mensagem de transição ao rotear, envia ela.
 *
 * Best-effort: erros aqui nunca derrubam o pipeline de mensagens.
 */
@Injectable()
export class AiConciergeService {
  private readonly logger = new Logger(AiConciergeService.name);
  private _client?: Anthropic;

  /**
   * Lock in-process por conversation_id. Quando o cliente manda várias
   * mensagens em rápida sequência ("Olá", "tudo bem?", "queria saber..."),
   * cada inbound dispara handle() em paralelo. Sem este lock duas execuções
   * podem ler `state=idle` simultaneamente e mandar greetings duplicados
   * (acontecia em prod 2026-05-04 com Ila/Ola/Sim em ~2s).
   *
   * Estratégia leader-based: a primeira chamada vira "líder" e processa.
   * Chamadas concorrentes apenas marcam `pendingRerun=true` e voltam.
   * Quando o líder termina, se houver pending, dispara um único rerun
   * com a mensagem mais recente da conversa (que já considera todas as
   * msgs anteriores via histórico).
   */
  private readonly inFlightHandlers = new Map<
    string,
    { pendingRerun: boolean }
  >();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly persona: AiPersonaService,
    private readonly tags: TagsService,
    private readonly appointments: AppointmentsService,
    private readonly events: EventsGateway,
  ) {}

  private getClient(): Anthropic {
    if (this._client) return this._client;
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY ausente');
    this._client = new Anthropic({ apiKey, maxRetries: 2 });
    return this._client;
  }

  // ──────────────────────────────────────────────────────────
  // Entry point — chamado pelo processInbound
  // ──────────────────────────────────────────────────────────

  async handle(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // Lock leader-based: se já tem handler em curso pra essa conv, marca
    // rerun pendente e sai. O líder vai re-processar a última msg quando
    // terminar — evita duplicação de greeting em msgs concorrentes.
    const existing = this.inFlightHandlers.get(conversationId);
    if (existing) {
      existing.pendingRerun = true;
      this.logger.debug(
        `concierge: handler já em curso pra conv ${conversationId} — rerun pendente`,
      );
      return;
    }
    this.inFlightHandlers.set(conversationId, { pendingRerun: false });

    const start = performance.now();
    let typingSignaled = false;
    try {
      const settings = await this.loadSettings(orgId);
      if (!settings.enabled) return;

      // Sinaliza "IA está digitando…" pro frontend ANTES de carregar
      // contexto pesado (loadHistory + Anthropic call). Reduz percepção
      // de latência — user vê feedback imediato em vez de re-mandar msg.
      const personaActive = await this.persona.getDefault(orgId).catch(() => null);
      if (settings.auto_reply) {
        this.events.emitToOrg(orgId, 'concierge:typing', {
          conversation_id: conversationId,
          typing: true,
          ...(personaActive?.name ? { persona_name: personaActive.name } : {}),
        });
        typingSignaled = true;
      }

      const conv = await this.loadConversation(orgId, conversationId);
      if (!conv) return;

      const state: ConciergeState =
        (conv.metadata as { concierge_state?: ConciergeState })?.concierge_state ?? 'idle';

      if (state === 'routed') {
        // Já roteou — concierge sai de cena, fluxo normal continua.
        return;
      }

      const message = await this.loadMessage(orgId, messageId);
      if (!message || message.direction !== 'inbound' || !message.plain_text) {
        return;
      }

      if (!personaActive) {
        this.logger.debug(
          `concierge: org ${orgId} sem persona default — nada a fazer`,
        );
        return;
      }

      if (state === 'idle') {
        await this.handleGreeting({
          orgId,
          conversationId,
          conversation: conv,
          settings,
          persona: personaActive,
        });
      } else if (state === 'awaiting_response') {
        await this.handleRoute({
          orgId,
          conversationId,
          conversation: conv,
          messageText: message.plain_text,
          settings,
          persona: personaActive,
        });
      } else if (state === 'awaiting_slot_choice') {
        await this.handleSlotChoice({
          orgId,
          conversationId,
          conversation: conv,
          messageText: message.plain_text,
          settings,
          persona: personaActive,
        });
      }

      this.logger.debug(
        `concierge done state=${state} conv=${conversationId} took=${Math.round(performance.now() - start)}ms`,
      );
    } catch (err) {
      this.logger.error(
        `concierge handler crashed (não fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      // Sinaliza fim do typing pro frontend (limpa indicador "IA digitando…")
      if (typingSignaled) {
        this.events.emitToOrg(orgId, 'concierge:typing', {
          conversation_id: conversationId,
          typing: false,
        });
      }

      const final = this.inFlightHandlers.get(conversationId);
      this.inFlightHandlers.delete(conversationId);
      // Se chegou msg nova durante o processamento, re-roda com a última
      // inbound da conversa (que já vai considerar todas as msgs anteriores
      // via histórico). Garante que não perdemos input do cliente.
      if (final?.pendingRerun) {
        this.logger.debug(
          `concierge: rerunning pra conv ${conversationId} (msg chegou durante processamento)`,
        );
        void this.rerunForLatestInbound(orgId, conversationId);
      }
    }
  }

  /**
   * Re-roda o handle pegando a mensagem inbound mais recente da conversa.
   * Chamado quando uma execução foi adiada via lock (pendingRerun) — pra
   * garantir que toda input do cliente seja processada eventualmente.
   */
  private async rerunForLatestInbound(
    orgId: string,
    conversationId: string,
  ): Promise<void> {
    const { data } = await this.supabase.adminClient
      .from('messages')
      .select('id')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .eq('direction', 'inbound')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const latestId = (data as { id?: string } | null)?.id;
    if (latestId) {
      await this.handle(orgId, conversationId, latestId);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Greeting — primeira interação
  // ──────────────────────────────────────────────────────────

  private async handleGreeting(args: {
    orgId: string;
    conversationId: string;
    conversation: ConversationRow;
    settings: ConciergeSettings;
    persona: AiAgentPersona;
  }): Promise<void> {
    const { orgId, conversationId, conversation, settings, persona } = args;

    let greeting: string;
    let usedAi = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let latencyMs = 0;

    const customGreeting = persona.greeting_message?.trim() ?? '';
    if (customGreeting) {
      // Interpola {{contact.name}} (nome completo) e {{contact.first_name}}
      // (só primeiro nome, mais natural pra cumprimento) — usa pushName
      // do WhatsApp quando contato vem de inbound do Baileys.
      const name = await this.fetchContactName(orgId, conversation.contact_id);
      const firstName = name ? (name.trim().split(/\s+/)[0] ?? name) : '';
      greeting = customGreeting
        .replaceAll('{{contact.name}}', name ?? '')
        .replaceAll('{{contact.first_name}}', firstName);
    } else {
      // Sem greeting customizada — gera na hora baseada na persona.
      const generated = await this.generateGreeting(
        persona,
        settings.business_context,
        await this.fetchContactName(orgId, conversation.contact_id),
      );
      greeting = generated.text;
      usedAi = generated.aiGenerated;
      inputTokens = generated.inputTokens;
      outputTokens = generated.outputTokens;
      latencyMs = generated.latencyMs;
    }

    // Log da interação (custo + tokens) — só quando IA foi de fato chamada
    if (usedAi) {
      void this.logInteraction({
        orgId,
        interactionType: 'concierge_greeting',
        inputTokens,
        outputTokens,
        latencyMs,
        conversationId,
        contactId: conversation.contact_id,
        resultSummary: greeting,
        metadata: {
          source: 'ai_concierge',
          persona_name: persona.name,
          tone: persona.tone ?? null,
        },
      });
    }

    if (settings.auto_reply) {
      // Humanização: persona pode ter response_delay_seconds (0-60s) que
      // simula tempo de digitação. Sem delay (0), envia na hora.
      await this.applyResponseDelay(persona);
      await this.sendOutbound(orgId, conversation, greeting);
    }

    await this.setConciergeState(orgId, conversationId, 'awaiting_response');
  }

  /**
   * Sleep baseado em persona.response_delay_seconds (cap em MAX_DELAY_MS).
   * Simula tempo de digitação humano. Quando 0/null, retorna imediato.
   */
  private async applyResponseDelay(persona: AiAgentPersona): Promise<void> {
    const seconds = Number(persona.response_delay_seconds ?? 0);
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const ms = Math.min(seconds * 1000, MAX_DELAY_MS);
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Loga interação de IA em active.ai_interactions com custo + tokens.
   * Best-effort — falha aqui não derruba o concierge.
   */
  private async logInteraction(args: {
    orgId: string;
    interactionType: 'concierge_greeting' | 'concierge_route' | 'concierge_qualify';
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    conversationId: string;
    contactId: string | null;
    resultSummary: string;
    metadata: Record<string, unknown>;
  }): Promise<void> {
    const cost =
      (args.inputTokens * SONNET_INPUT_PER_MTOK +
        args.outputTokens * SONNET_OUTPUT_PER_MTOK) /
      1_000_000;
    try {
      await this.supabase.adminClient.from('ai_interactions').insert({
        org_id: args.orgId,
        interaction_type: args.interactionType,
        model: SONNET_MODEL_ID,
        provider: 'anthropic',
        input_tokens: args.inputTokens,
        output_tokens: args.outputTokens,
        cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
        latency_ms: args.latencyMs,
        conversation_id: args.conversationId,
        contact_id: args.contactId,
        user_id: null,
        result_summary: args.resultSummary.slice(0, 200),
        metadata: args.metadata,
      });
    } catch (err) {
      this.logger.warn(
        `logInteraction concierge falhou (não fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async generateGreeting(
    persona: AiAgentPersona,
    businessContext: string,
    contactName: string | null,
  ): Promise<{
    text: string;
    inputTokens: number;
    outputTokens: number;
    latencyMs: number;
    aiGenerated: boolean;
  }> {
    const tonePt = this.tonePt(persona.tone);
    const role = persona.role ?? 'assistant';
    const personality = persona.personality ?? '';
    const guidelines = (persona.guidelines ?? []).join('\n- ');
    const forbidden = (persona.forbidden_topics ?? []).join(', ');

    const system = `Você é ${persona.name}, ${role.replace(/_/g, ' ')} de uma empresa.
Tom de voz: ${tonePt}.
${personality ? `Personalidade: ${personality}` : ''}
${businessContext ? `Sobre a empresa: ${businessContext}` : ''}
${guidelines ? `Diretrizes:\n- ${guidelines}` : ''}
${forbidden ? `Tópicos a evitar: ${forbidden}` : ''}

Tarefa: gerar UMA mensagem curta (2-3 linhas, máx 280 caracteres) de saudação INICIAL para um cliente que acabou de iniciar contato. A mensagem DEVE terminar com UMA pergunta direta e amigável que ajude a entender o que o cliente busca (ex: "Como posso te ajudar hoje?", "Está procurando algo específico?").

NÃO use emojis em excesso (máximo 1).
NÃO faça perguntas múltiplas.
Retorne APENAS o texto da mensagem, sem aspas, sem explicações.`;

    const user = contactName
      ? `Cliente: ${contactName}`
      : 'Cliente novo (sem nome conhecido)';

    const start = performance.now();
    try {
      const res = await this.getClient().messages.create({
        model: SONNET_MODEL_ID,
        max_tokens: 256,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const block = res.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const text = block?.text?.trim() ?? '';
      if (text) {
        return {
          text,
          inputTokens: res.usage.input_tokens,
          outputTokens: res.usage.output_tokens,
          latencyMs: Math.round(performance.now() - start),
          aiGenerated: true,
        };
      }
    } catch (err) {
      this.logger.warn(
        `generateGreeting fallback to fallback_message: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const fallback =
      persona.fallback_message?.trim() || 'Olá! Como posso te ajudar hoje?';
    return {
      text: fallback,
      inputTokens: 0,
      outputTokens: 0,
      latencyMs: Math.round(performance.now() - start),
      aiGenerated: false,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Route — cliente respondeu à saudação
  // ──────────────────────────────────────────────────────────

  private async handleRoute(args: {
    orgId: string;
    conversationId: string;
    conversation: ConversationRow;
    messageText: string;
    settings: ConciergeSettings;
    persona: AiAgentPersona;
  }): Promise<void> {
    const { orgId, conversationId, conversation, messageText, settings, persona } = args;

    // 1. Card na PRIMEIRA etapa do funil default — independente do que a
    //    IA decidir, atendente humano vê o lead aparecendo no /funis assim
    //    que ele responde a primeira pergunta. Etapas subsequentes são
    //    movidas pela IA do Concierge via upsertDealForRoute quando ela
    //    decide rotear (com pipeline+stage específicos).
    void this.ensureDealAtFirstStage(orgId, conversation.contact_id).catch(
      (err: unknown) =>
        this.logger.warn(
          `concierge: ensureDealAtFirstStage falhou: ${err instanceof Error ? err.message : String(err)}`,
        ),
    );

    // 2. Carrega pipelines com stages
    const pipelines = await this.loadPipelines(orgId);
    if (pipelines.length === 0) {
      this.logger.warn(`concierge: org ${orgId} sem pipelines — não pode rotear`);
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    // 3. Carrega histórico curto pra IA ter contexto
    const history = await this.loadHistory(orgId, conversationId);

    // 3. Carrega catálogo de tags da org (deal) — IA usa pra reusar tags
    //    existentes em vez de criar variações ("CONVENIO_GAMA" vs "GAMA").
    const tagCatalog = await this.tags
      .list(orgId, { entity_type: 'deal' })
      .catch(() => [] as TagDefinition[]);

    // 4. Conta turnos de qualificação já gastos. Se atingiu o teto,
    //    força roteamento mesmo com info parcial pra evitar loop infinito.
    const qualifyingTurns =
      ((conversation.metadata as { qualifying_turns?: number } | null)
        ?.qualifying_turns ?? 0);
    const forceRoute = qualifyingTurns >= MAX_QUALIFYING_TURNS;

    // 5. Pega o nome do contato (pushName do WhatsApp ou cadastro) pra IA
    //    poder personalizar respostas — torna a conversa mais conectada e
    //    menos genérica/robótica.
    const contactName = await this.fetchContactName(orgId, conversation.contact_id);

    // 6. IA decide: qualifica mais OU roteia agora
    const decision = await this.askIaToRoute({
      pipelines,
      history,
      latestMessage: messageText,
      persona,
      businessContext: settings.business_context,
      qualifyingTurns,
      forceRoute,
      tagCatalog,
      contactName,
    });

    if (!decision) {
      this.logger.warn(
        `concierge: IA não conseguiu decidir rota pra conv ${conversationId}`,
      );
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    // 5. Caminho A — IA quer mais info. Manda próxima pergunta e fica
    //    em awaiting_response (loop continua na próxima inbound).
    if (decision.needs_more_info && decision.next_question && !forceRoute) {
      // Log do turno de qualificação
      if (decision._usage) {
        void this.logInteraction({
          orgId,
          interactionType: 'concierge_qualify',
          inputTokens: decision._usage.inputTokens,
          outputTokens: decision._usage.outputTokens,
          latencyMs: decision._usage.latencyMs,
          conversationId,
          contactId: conversation.contact_id,
          resultSummary: `turno ${qualifyingTurns + 1}: ${decision.next_question.slice(0, 120)}`,
          metadata: {
            source: 'ai_concierge',
            qualifying_turn: qualifyingTurns + 1,
            next_question: decision.next_question,
            reasoning: decision.reasoning,
          },
        });
      }

      // Envia a pergunta com response delay humanizado
      if (settings.auto_reply) {
        await this.applyResponseDelay(persona);
        await this.sendOutbound(orgId, conversation, decision.next_question);
      }

      // Persiste contador + mantém state em awaiting_response
      await this.updateConciergeMetadata(orgId, conversationId, {
        concierge_state: 'awaiting_response',
        qualifying_turns: qualifyingTurns + 1,
      });

      this.logger.log(
        `concierge: qualifying turn ${qualifyingTurns + 1}/${MAX_QUALIFYING_TURNS} conv=${conversationId}`,
      );
      return;
    }

    // 6. Caminho B — roteamento normal. IA tem info suficiente (ou
    //    estamos forçando porque atingiu o teto de turnos).
    if (!decision.pipeline_id || !decision.stage_id) {
      this.logger.warn(
        `concierge: routing sem pipeline_id/stage_id (forceRoute=${forceRoute}) — abortando`,
      );
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    // Log da chamada IA de roteamento (custo + tokens + tags pra observabilidade)
    if (decision._usage) {
      void this.logInteraction({
        orgId,
        interactionType: 'concierge_route',
        inputTokens: decision._usage.inputTokens,
        outputTokens: decision._usage.outputTokens,
        latencyMs: decision._usage.latencyMs,
        conversationId,
        contactId: conversation.contact_id,
        resultSummary: `${decision.intent_label} → ${decision.temperature}`,
        metadata: {
          source: 'ai_concierge',
          pipeline_id: decision.pipeline_id,
          stage_id: decision.stage_id,
          intent_label: decision.intent_label,
          temperature: decision.temperature,
          reasoning: decision.reasoning,
          tags: decision.tags,
          qualifying_turns_used: qualifyingTurns,
          force_routed: forceRoute,
        },
      });
    }

    // Registra/incrementa tags no catálogo (cria as inéditas, soma usage_count
    // nas existentes). Best-effort — falha aqui não bloqueia criação do deal.
    if (decision.tags.length > 0) {
      void this.tags
        .upsertMany(orgId, 'deal', decision.tags)
        .catch((err: unknown) =>
          this.logger.warn(
            `concierge: upsertMany tags falhou: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
    }

    // Atualiza o deal existente (criado em ensureDealAtFirstStage) com o
    // stage final decidido pela IA + tags semânticas. Se por algum motivo
    // não existe (ex: ensureDealAtFirstStage falhou ou edge-case), cria
    // como fallback diretamente no stage decidido.
    const dealCreated = await this.upsertDealForRoute({
      orgId,
      contactId: conversation.contact_id,
      pipelineId: decision.pipeline_id,
      stageId: decision.stage_id,
      reasoning: decision.reasoning,
      intentLabel: decision.intent_label ?? 'sem_label',
      tags: decision.tags,
    });

    // Atualiza temperatura + propaga as tags semânticas pro CONTATO também.
    // Tags do contato são merge (preserva tags pre-existentes), de-dup, cap 12.
    if (decision.temperature || decision.tags.length > 0) {
      const patch: Record<string, unknown> = {};
      if (decision.temperature) patch.temperature = decision.temperature;
      if (decision.tags.length > 0) {
        const { data: c } = await this.supabase.adminClient
          .from('contacts')
          .select('tags')
          .eq('org_id', orgId)
          .eq('id', conversation.contact_id)
          .maybeSingle();
        const existing = ((c?.tags as string[] | null) ?? []).filter(
          (t): t is string => typeof t === 'string',
        );
        const merged = Array.from(new Set([...existing, ...decision.tags])).slice(0, 12);
        patch.tags = merged;
      }
      await this.supabase.adminClient
        .from('contacts')
        .update(patch)
        .eq('org_id', orgId)
        .eq('id', conversation.contact_id);
    }

    // Detecta intent de agendamento via tag — quando presente, em vez de
    // mandar só o bridge_message genérico, monta proposta com 3 horários
    // reais (calculados via AppointmentsService) e transiciona pra
    // awaiting_slot_choice. Lead vai responder com 1/2/3 e Concierge cria
    // o appointment automaticamente.
    const wantsScheduling = decision.tags.includes('AGENDAMENTO_SOLICITADO');
    let stateAfterRoute: ConciergeState = 'routed';

    if (wantsScheduling && settings.auto_reply) {
      const offered = await this.proposeSlotsAndPersist({
        orgId,
        conversationId,
        conversation,
        persona,
        specialty: decision.specialty_guess,
        bridgeMessage: decision.bridge_message,
        originMessage: messageText,
      });
      if (offered) {
        stateAfterRoute = 'awaiting_slot_choice';
      } else if (decision.bridge_message) {
        // Sem slots disponíveis — manda bridge_message original (que já avisa
        // que equipe humana entra em contato).
        await this.applyResponseDelay(persona);
        await this.sendOutbound(orgId, conversation, decision.bridge_message);
      }
    } else if (
      settings.send_bridge_message &&
      settings.auto_reply &&
      decision.bridge_message
    ) {
      // Caminho normal — bridge_message comum sem agendamento
      await this.applyResponseDelay(persona);
      await this.sendOutbound(orgId, conversation, decision.bridge_message);
    }

    await this.setConciergeState(orgId, conversationId, stateAfterRoute);

    this.logger.log(
      `concierge: roteou conv=${conversationId} → pipeline=${decision.pipeline_id} stage=${decision.stage_id} intent=${decision.intent_label} temp=${decision.temperature} deal_created=${dealCreated} turns=${qualifyingTurns}`,
    );
  }

  private async askIaToRoute(args: {
    pipelines: PipelineWithStages[];
    history: HistoryItem[];
    latestMessage: string;
    persona: AiAgentPersona;
    businessContext: string;
    qualifyingTurns: number;
    forceRoute: boolean;
    tagCatalog: TagDefinition[];
    contactName: string | null;
  }): Promise<RouteDecision | null> {
    const { pipelines, history, latestMessage, persona, businessContext, qualifyingTurns, forceRoute, tagCatalog, contactName } = args;

    // Pega só o primeiro nome pra IA usar de forma natural
    // ("Maria Silva" → "Maria"), sem soar formal demais.
    const getFirstName = (full: string): string =>
      full.trim().split(/\s+/)[0] ?? full;

    const pipelinesText = pipelines
      .map((p) => {
        const stages = p.stages
          .filter((s) => !s.is_won && !s.is_lost) // foca só em stages ativos
          .map(
            (s) =>
              `    - id=${s.id} | "${s.name}"${s.description ? ` — ${s.description}` : ''}`,
          )
          .join('\n');
        return `Pipeline id=${p.id} | "${p.name}"${p.description ? ` — ${p.description}` : ''}${p.is_default ? ' (DEFAULT)' : ''}\n  Stages disponíveis:\n${stages}`;
      })
      .join('\n\n');

    const historyText = history
      .map(
        (h) =>
          `  ${h.direction === 'inbound' ? '👤 Cliente' : '🤖 Empresa'}: ${h.text}`,
      )
      .join('\n');

    const tonePt = this.tonePt(persona.tone);
    const guidelinesText = (persona.guidelines ?? []).join('\n').trim();

    // Catálogo de tags existentes — IA prioriza reuso pra manter taxonomia
    // estável e evitar variações ("CONVENIO_GAMA" vs "GAMA_CONV"). Limita
    // por usage_count pra caber no prompt sem inflacionar tokens.
    const topTags = [...tagCatalog]
      .sort((a, b) => b.usage_count - a.usage_count)
      .slice(0, 50);
    const tagCatalogText = topTags.length === 0
      ? '(catálogo vazio — fique livre pra criar tags inéditas)'
      : topTags
          .map((t) => `  • ${t.slug}${t.description ? ` — ${t.description}` : ''}${t.category ? ` [${t.category}]` : ''}`)
          .join('\n');

    const system = `Você é um sistema de QUALIFICAÇÃO e roteamento inteligente de leads num CRM. Em cada turno você decide UMA de duas coisas:
(a) ainda falta informação importante pra qualificar o lead → faz a próxima pergunta natural;
(b) já tem informação suficiente → roteia o lead pro pipeline+stage correto.

NUNCA pareça um robô ou interrogatório. Cada pergunta deve fluir naturalmente como uma conversa humana, no tom ${tonePt}, no estilo da persona descrita abaixo.

═══════════════════════════════════════════
PERSONA QUE INTERAGE COM O CLIENTE: ${persona.name} (${persona.role ?? 'assistant'}, tom ${tonePt})

PERSONALIDADE:
${persona.personality || '(sem personalidade detalhada)'}

DIRETRIZES DA PERSONA (use isso pra saber QUAIS informações coletar e COMO conduzir):
${guidelinesText || '(sem guidelines explícitas — use senso comum no tom da persona)'}
═══════════════════════════════════════════

CLIENTE: ${contactName ? `${contactName} (use o primeiro nome com naturalidade — ex: "Tudo bem, ${getFirstName(contactName)}?", sem repetir em toda mensagem)` : '(sem nome cadastrado — não invente nome, use linguagem neutra)'}

CONTEXTO DA EMPRESA:
${businessContext || '(sem contexto detalhado)'}

═══════════════════════════════════════════
PIPELINES DISPONÍVEIS NESTA ORG (use SÓ se for rotear):
${pipelinesText}
═══════════════════════════════════════════

CATÁLOGO DE TAGS DA ORG (já existentes — REUSE quando bater no caso!):
${tagCatalogText}

⚠️ Sempre que o caso já bater com uma tag do catálogo acima, USE A MESMA
slug exata. Só crie tag inédita quando NENHUMA do catálogo cobrir o caso —
isso mantém taxonomia consistente entre leads e facilita filtros futuros.
═══════════════════════════════════════════

ESTADO ATUAL DA QUALIFICAÇÃO: turno ${qualifyingTurns + 1} de no máximo ${MAX_QUALIFYING_TURNS}.
${forceRoute ? '⚠️ ATINGIU O LIMITE DE TURNOS — VOCÊ DEVE ROTEAR AGORA mesmo com info parcial. Ignore needs_more_info e escolha o melhor pipeline+stage com o que tem.' : ''}

REGRAS:

1. **Avalie o histórico + última mensagem.** A persona tem diretrizes sobre quais informações coletar (ex: convênio vs particular, tipo de tratamento, especialidade, etc.). Cheque o que JÁ FOI dito vs o que FALTA.

2. **Se ainda falta info importante e qualifying_turns < ${MAX_QUALIFYING_TURNS}:**
   - "needs_more_info": true
   - "next_question": **UMA pergunta DIRETA**, no tom ${tonePt}, abordando UM ASPECTO por vez (não amontoe perguntas). DEVE terminar com "?" e fazer uma pergunta concreta. Pode começar com 1 frase curta de empatia/confirmação do que o cliente disse, mas o final SEMPRE precisa ser uma pergunta real. Máx 200 chars.

   ❌ ERRADO (frase de transição sem pergunta):
     "Que bom ter você aqui! Vou te fazer algumas perguntinhas pra entender melhor."
     "Entendi! Já anotei aqui."
     "Vou te ajudar com cuidado."
   ✅ CERTO (uma pergunta concreta):
     "Que bom! Pra te orientar melhor — você está buscando consulta, exame ou já tem indicação de tratamento?"
     "Entendi. E o atendimento seria por convênio ou particular?"
     "Anotado. Qual especialidade ou tipo de tratamento te trouxe até a gente?"

   - Os outros campos (pipeline_id, stage_id, etc.) podem ser null.

3. **Se já tem info suficiente OU está em forceRoute:**
   - "needs_more_info": false
   - **AGENDAMENTO**: se o cliente PEDIU agendamento explicitamente
     ("quero agendar", "tem horário?", "vagas pra X", "marcar consulta",
     "agendar tratamento", "quando posso ir", etc.):
     • SEMPRE inclua a tag "AGENDAMENTO_SOLICITADO" em "tags"
     • Prefira stages avançados ("Aguardando agendamento", "Agendado",
       ou similar conforme as descrições)
     • A bridge_message DEVE indicar que a equipe humana entrará em
       contato pra propor data/horário concreto (NUNCA prometa horário
       específico — você não tem acesso à agenda real do profissional)
     • Aumente a temperatura pra "hot" (cliente quer agir)
   - "pipeline_id": ID do pipeline que melhor encaixa
   - "stage_id": ID de UM stage DISPONÍVEL desse pipeline.

     ⚠️ **Escolha o stage que reflete o ESTADO ATUAL DO LEAD**, NÃO "onde ele começa".
     - Lead que só disse "oi" e nada mais → stage inicial (ex: Primeiro Contato).
     - Lead que JÁ TEM intenção clara + 1-2 dados-chave (tipo de tratamento, convênio,
       prazo, urgência, especialidade, etc.) → stage de QUALIFICAÇÃO ATIVA
       ou superior (ex: Qualificação inicial, Documento pendente).
     - Lead que JÁ ENVIOU documentos / propostas / dados completos → stage avançado.
     - Use as descrições dos stages pra escolher o encaixe certo. Não seja conservador —
       escolha o stage real, não o "seguro".

   - "temperature": "cold" (curiosidade) | "warm" (interesse genuíno) | "hot" (pronto/qualificado) | "very_hot" (urgência)
   - "intent_label": label curto descritivo (ex: "consulta_oncologia_convenio_bradesco")
   - "bridge_message": frase CURTA (máx 200 chars) no tom ${tonePt} avisando próximo passo. NULL se não fizer sentido enviar.
   - "tags": array OBRIGATÓRIO com **3 a 6 tags semânticas** representando
     CADA dado-chave coletado durante a qualificação. **NUNCA retorne array
     vazio quando needs_more_info=false** — pelo menos 3 tags são esperadas.
     Use UPPERCASE_SNAKE_CASE, sem acento, palavras curtas.
     Como gerar:
     • Para CADA aspecto qualificado, gere 1 tag específica.
     • Exemplos pra clínica/saúde:
       - "NOVO_PACIENTE" ou "PACIENTE_RECORRENTE"
       - "TRATAMENTO_INFUSAO" ou "CONSULTA" ou "EXAME"
       - "CONVENIO_GAMA" ou "PARTICULAR"
       - "ESPECIALIDADE_ONCOLOGIA"
       - "URGENTE" ou "ELETIVO"
     • Exemplos pra vendas/imobiliário/varejo:
       - "INTERESSE_PREMIUM", "FAIXA_ALTA", "DECISOR", "URGENTE"
       - "VAREJO_FINAL", "PROFISSIONAL_B2B"
     **NÃO inclua** "AI_CONCIERGE" (já é adicionada automaticamente).
     Se for "forceRoute" e quase não tem info, gere ao menos 1 tag genérica
     (ex: "INFO_PARCIAL" ou "PRIMEIRO_CONTATO").

4. "reasoning": SEMPRE preencha. Frase curta explicando o porquê (de qualificar mais OU de rotear pra esse pipeline/stage).

5. **NÃO precisa esgotar todas as diretrizes da persona** — quando você tiver clareza MÍNIMA da intenção principal + 1-2 dados-chave, pode rotear.

6. **specialty_guess** (relevante só se "AGENDAMENTO_SOLICITADO" tá em tags):
   - String em **lower-case** representando o serviço/especialidade que o
     cliente busca (ex: "nutricionista", "oncologia", "corte", "manicure",
     "motor", "elétrica", "vendas", "consultoria").
   - O sistema vai usar esta string pra fazer match contra
     org_members.specialties (texto livre). Use o termo mais natural do
     nicho — não invente categorias. Se a mensagem só diz "consulta" sem
     especificar especialidade, retorne null.
   - Quando NÃO há AGENDAMENTO_SOLICITADO, deixe null.

Retorne APENAS JSON puro com este shape exato:
{
  "needs_more_info": <true|false>,
  "next_question": "<string ou null>",
  "pipeline_id": "<uuid ou null>",
  "stage_id": "<uuid ou null>",
  "intent_label": "<string ou null>",
  "temperature": "cold|warm|hot|very_hot ou null",
  "bridge_message": "<string ou null>",
  "tags": ["TAG_1", "TAG_2", "TAG_3"] (3-6 itens; vazio APENAS quando needs_more_info=true),
  "specialty_guess": "<string lower-case ou null>",
  "reasoning": "<string>"
}`;

    const user = `HISTÓRICO DA CONVERSA:
${historyText || '(sem histórico anterior)'}

ÚLTIMA MENSAGEM DO CLIENTE:
"${latestMessage}"

Decida o roteamento.`;

    const start = performance.now();
    try {
      const res = await this.getClient().messages.create({
        model: SONNET_MODEL_ID,
        max_tokens: 600,
        system,
        messages: [{ role: 'user', content: user }],
      });
      const usage = {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
        latencyMs: Math.round(performance.now() - start),
      };
      const block = res.content.find(
        (b): b is Anthropic.TextBlock => b.type === 'text',
      );
      const text = block?.text?.trim() ?? '';
      if (!text) return null;

      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
      let json: unknown;
      try {
        json = JSON.parse(cleaned);
      } catch {
        const m = cleaned.match(/\{[\s\S]*\}/);
        if (!m) return null;
        json = JSON.parse(m[0]);
      }

      const d = json as Partial<RouteDecision>;

      // Caminho A: IA pede mais info — precisa de needs_more_info=true E
      // next_question com "?" (caso contrário a IA tipicamente gerou
      // frase de transição vazia tipo "Vou te fazer algumas perguntinhas..."
      // sem pergunta real, travando a conversa).
      if (d.needs_more_info === true) {
        const nq = typeof d.next_question === 'string' ? d.next_question.trim() : '';
        let finalQuestion = nq;
        if (!nq) {
          this.logger.warn(`concierge IA needs_more_info=true mas sem next_question — usando fallback`);
          finalQuestion = 'E pra eu te orientar melhor — qual seria sua principal necessidade ou dúvida no momento?';
        } else if (!nq.includes('?')) {
          this.logger.warn(
            `concierge IA gerou next_question sem "?" (provável frase de transição): "${nq}" — anexando fallback`,
          );
          finalQuestion = `${nq.replace(/[.!]+$/, '')} Pode me contar um pouquinho do que você precisa?`;
        }
        return {
          needs_more_info: true,
          next_question: finalQuestion,
          pipeline_id: null,
          stage_id: null,
          intent_label: null,
          temperature: null,
          bridge_message: null,
          tags: [],
          specialty_guess: null,
          reasoning: d.reasoning ?? '',
          _usage: usage,
        };
      }

      // Caminho B: IA roteia — precisa de pipeline+stage+intent+temperature
      if (!d.pipeline_id || !d.stage_id || !d.intent_label || !d.temperature) {
        this.logger.warn(`concierge IA roteamento incompleto: ${cleaned.slice(0, 200)}`);
        return null;
      }
      const pipeline = pipelines.find((p) => p.id === d.pipeline_id);
      if (!pipeline) {
        this.logger.warn(`concierge IA escolheu pipeline_id inexistente: ${d.pipeline_id}`);
        return null;
      }
      const stage = pipeline.stages.find((s) => s.id === d.stage_id);
      if (!stage) {
        this.logger.warn(
          `concierge IA escolheu stage_id ${d.stage_id} fora do pipeline ${d.pipeline_id}`,
        );
        return null;
      }

      // Tags semânticas — sluga pra UPPERCASE_SNAKE_CASE, remove duplicatas
      // e cap em 6 tags pra não poluir o card.
      const rawTags = Array.isArray(d.tags) ? d.tags : [];
      const tags = Array.from(
        new Set(
          rawTags
            .filter((t): t is string => typeof t === 'string')
            .map((t) =>
              t
                .normalize('NFD')
                .replace(/[̀-ͯ]/g, '')
                .toUpperCase()
                .replace(/[^A-Z0-9]+/g, '_')
                .replace(/^_+|_+$/g, ''),
            )
            .filter((t) => t.length > 0 && t !== 'AI_CONCIERGE'),
        ),
      ).slice(0, 6);

      // specialty_guess: lower-case + trim. Null se ausente ou ""/"null".
      const rawSpecialty =
        typeof d.specialty_guess === 'string' ? d.specialty_guess.trim() : '';
      const specialtyGuess =
        rawSpecialty && rawSpecialty.toLowerCase() !== 'null'
          ? rawSpecialty.toLowerCase()
          : null;

      return {
        needs_more_info: false,
        next_question: null,
        pipeline_id: d.pipeline_id,
        stage_id: d.stage_id,
        intent_label: d.intent_label,
        temperature: d.temperature as ContactTemperature,
        bridge_message:
          typeof d.bridge_message === 'string' && d.bridge_message.trim()
            ? d.bridge_message.trim()
            : null,
        tags,
        specialty_guess: specialtyGuess,
        reasoning: d.reasoning ?? '',
        _usage: usage,
      };
    } catch (err) {
      this.logger.warn(
        `askIaToRoute falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }

  /**
   * Garante que o contato tenha um deal aberto na PRIMEIRA etapa do
   * pipeline default. Chamado mecanicamente após o lead responder a 1ª
   * pergunta (turno 1 do qualifying), pra que o card já apareça no funil
   * desde o início — atendente humano vê leads ativos sem esperar a IA
   * decidir o roteamento.
   *
   * Etapas subsequentes (qualificação/Documento Pendente/Aprovado/etc.)
   * seguem a inteligência do Concierge: cada vez que ele roteia, faz
   * UPDATE do deal pro stage decidido pela IA via upsertDealForRoute.
   *
   * Idempotente: se já tem deal aberto, retorna sem criar outro.
   */
  private async ensureDealAtFirstStage(
    orgId: string,
    contactId: string,
  ): Promise<string | null> {
    // Já tem deal aberto?
    const { data: existing } = await this.supabase.adminClient
      .from('deals')
      .select('id')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .is('won_at', null)
      .is('lost_at', null)
      .limit(1)
      .maybeSingle();
    if (existing?.id) return existing.id as string;

    const pipelines = await this.loadPipelines(orgId);
    if (pipelines.length === 0) return null;

    // Pipeline default; fallback pro primeiro
    const def = pipelines.find((p) => p.is_default) ?? pipelines[0];
    if (!def) return null;

    // Primeira etapa não-terminal (won/lost ficam por último)
    const firstStage = [...def.stages]
      .filter((s) => !s.is_won && !s.is_lost)
      .sort((a, b) => a.position - b.position)[0];
    if (!firstStage) return null;

    const contactName = await this.fetchContactName(orgId, contactId);
    const { data: created, error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        pipeline_id: def.id,
        stage_id: firstStage.id,
        title: contactName ?? 'Novo lead',
        tags: ['ai-concierge', 'EM_QUALIFICACAO'],
        custom_fields: {
          ai_concierge: {
            stage: 'first_response',
            created_at: new Date().toISOString(),
          },
        },
      })
      .select('id')
      .single();

    if (error || !created) {
      this.logger.warn(
        `concierge: ensureDealAtFirstStage falhou: ${error?.message ?? 'unknown'}`,
      );
      return null;
    }
    return (created as { id: string }).id;
  }

  /**
   * Após o Concierge fazer route (decisão final da IA), atualiza o deal
   * existente (criado em ensureDealAtFirstStage) com o stage final +
   * pipeline correto + tags semânticas. Se por alguma razão não tem deal
   * aberto, cria como fallback.
   */
  private async upsertDealForRoute(args: {
    orgId: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    reasoning: string;
    intentLabel: string;
    tags: string[];
  }): Promise<boolean> {
    const { orgId, contactId, pipelineId, stageId, reasoning, intentLabel, tags } = args;

    const { data: existing } = await this.supabase.adminClient
      .from('deals')
      .select('id, tags')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .is('won_at', null)
      .is('lost_at', null)
      .limit(1)
      .maybeSingle();

    // Tags finais: ai-concierge + tags da IA. Remove "EM_QUALIFICACAO"
    // (placeholder do turno 1) — se a IA roteou, qualificação acabou.
    const baseTags = (existing?.tags as string[] | null) ?? [];
    const merged = Array.from(
      new Set(
        [...baseTags, 'ai-concierge', ...tags].filter((t) => t !== 'EM_QUALIFICACAO'),
      ),
    );

    if (existing?.id) {
      const { error } = await this.supabase.adminClient
        .from('deals')
        .update({
          pipeline_id: pipelineId,
          stage_id: stageId,
          tags: merged,
          custom_fields: {
            ai_concierge: {
              intent_label: intentLabel,
              reasoning,
              routed_at: new Date().toISOString(),
              tags,
            },
          },
        })
        .eq('id', existing.id);
      if (error) {
        this.logger.warn(`concierge: update deal falhou: ${error.message}`);
        return false;
      }
      return true;
    }

    // Fallback: não tem deal (não passou pelo ensureDealAtFirstStage por
    // algum motivo). Cria do zero no stage decidido pela IA.
    const contactName = await this.fetchContactName(orgId, contactId);
    const { error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: contactName ?? 'Novo lead',
        tags: merged,
        custom_fields: {
          ai_concierge: {
            intent_label: intentLabel,
            reasoning,
            routed_at: new Date().toISOString(),
            tags,
          },
        },
      });
    if (error) {
      this.logger.warn(`concierge: insert deal (fallback) falhou: ${error.message}`);
      return false;
    }
    return true;
  }

  // ──────────────────────────────────────────────────────────
  // Scheduling — proposta de slots + recebimento da escolha
  // ──────────────────────────────────────────────────────────

  /**
   * Calcula slots disponíveis na org filtrando por specialty (quando
   * informada), pega os 3 melhores (distintos em dia/horário quando
   * possível), monta mensagem friendly numerada e persiste a oferta no
   * conversation.metadata pra ser consumida em handleSlotChoice.
   *
   * Retorna true se conseguiu propor pelo menos 1 slot (e estado deve
   * ir pra awaiting_slot_choice). Retorna false quando não há slot
   * disponível — chamador decide o fallback (bridge message normal).
   */
  private async proposeSlotsAndPersist(args: {
    orgId: string;
    conversationId: string;
    conversation: ConversationRow;
    persona: AiAgentPersona;
    specialty: string | null;
    bridgeMessage: string | null;
    originMessage: string;
  }): Promise<boolean> {
    const { orgId, conversationId, conversation, persona, specialty, bridgeMessage, originMessage } = args;

    let slots: AvailabilitySlot[] = [];
    try {
      slots = await this.appointments.findSlotsForOrg(orgId, {
        ...(specialty ? { specialty } : {}),
        daysAhead: 7,
        limit: 24, // pega mais pra ter margem ao distribuir
        fallbackDurationMinutes: 30,
      });
    } catch (err) {
      this.logger.warn(
        `concierge: findSlotsForOrg falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }

    if (slots.length === 0) {
      this.logger.log(
        `concierge: sem slots disponíveis pra specialty="${specialty}" — fallback pra bridge_message`,
      );
      return false;
    }

    // Distribui — pega slots em momentos diferentes (idealmente em dias
    // diferentes ou horários diferentes do mesmo dia) pra dar opção real.
    const picked = this.pickDistributedSlots(slots, SLOT_OPTIONS_TO_SHOW);
    if (picked.length === 0) return false;

    const offered: OfferedSlot[] = picked.map((s, i) => ({
      index: i + 1,
      start_time: s.start_time,
      end_time: s.end_time,
      agent_id: s.agent_id,
      agent_name: s.agent_name,
      duration_minutes: s.duration_minutes ?? 30,
    }));

    const intro =
      bridgeMessage?.trim() ||
      `Posso te ajudar com isso! Tenho ${picked.length === 1 ? 'um horário' : 'esses horários'} disponíve${picked.length === 1 ? 'l' : 'is'}:`;
    const text = `${intro}\n\n${this.formatSlotsForUser(offered)}\n\nQual prefere? Pode me responder com o número (${offered.map((o) => o.index).join(', ')}).`;

    await this.applyResponseDelay(persona);
    await this.sendOutbound(orgId, conversation, text);

    const schedulingMeta: SchedulingMetadata = {
      offered_slots: offered,
      specialty: specialty ?? null,
      proposed_at: new Date().toISOString(),
      retries: 0,
      origin_message: originMessage.slice(0, 500),
    };
    await this.updateConciergeMetadata(orgId, conversationId, {
      scheduling: schedulingMeta,
    });

    this.logger.log(
      `concierge: propôs ${offered.length} slots (specialty="${specialty}") conv=${conversationId}`,
    );
    return true;
  }

  /**
   * Pega N slots tentando distribuir entre dias diferentes pra dar opção
   * real. Se não conseguir (ex: só tem slot pra amanhã), pega os primeiros
   * sequenciais.
   */
  private pickDistributedSlots(
    slots: AvailabilitySlot[],
    n: number,
  ): AvailabilitySlot[] {
    if (slots.length <= n) return slots.slice(0, n);

    const byDay = new Map<string, AvailabilitySlot[]>();
    for (const s of slots) {
      const day = s.start_time.slice(0, 10);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day)!.push(s);
    }

    const out: AvailabilitySlot[] = [];
    const dayKeys = [...byDay.keys()].sort();

    // Round-robin: pega o primeiro slot de cada dia até preencher n
    let idx = 0;
    while (out.length < n && dayKeys.length > 0) {
      const dayKey = dayKeys[idx % dayKeys.length];
      if (!dayKey) break;
      const daySlots = byDay.get(dayKey)!;
      if (daySlots.length === 0) {
        dayKeys.splice(idx % dayKeys.length, 1);
        continue;
      }
      out.push(daySlots.shift()!);
      idx++;
    }

    return out.slice(0, n);
  }

  /**
   * Formata os slots como lista numerada amigável em pt-BR. Usa
   * Intl.DateTimeFormat com timezone São Paulo (default da org). Inclui
   * agente quando há múltiplos com nomes distintos.
   */
  private formatSlotsForUser(offered: OfferedSlot[]): string {
    const tz = 'America/Sao_Paulo';
    const dayFmt = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'short',
      day: '2-digit',
      month: 'short',
      timeZone: tz,
    });
    const timeFmt = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });

    const distinctAgents = new Set(offered.map((o) => o.agent_id));
    const showAgent = distinctAgents.size > 1;

    return offered
      .map((s) => {
        const d = new Date(s.start_time);
        const dayLabel = dayFmt.format(d).replace(/\./g, '');
        const timeLabel = timeFmt.format(d);
        const agentSuffix =
          showAgent && s.agent_name ? ` com ${s.agent_name}` : '';
        return `${s.index}️⃣ ${dayLabel} às ${timeLabel}${agentSuffix}`;
      })
      .join('\n');
  }

  /**
   * Parser simples — tenta detectar qual slot o lead escolheu. Cobre:
   * "1", "2", "3", "primeira", "segunda", "terceira", "primeiro",
   * "opção 2", "a 1", "quero a 2", "n.3", emojis 1️⃣/2️⃣/3️⃣, etc.
   *
   * Retorna 1-based index ou null se ambíguo. Estratégia conservadora:
   * só retorna match se for inequívoco.
   */
  private parseSlotChoice(text: string, max: number): number | null {
    const norm = text
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim();

    // Emoji digit (1️⃣) — pega o primeiro caractere de dígito
    const emojiDigitMatch = text.match(/([1-9])️?⃣/);
    if (emojiDigitMatch && emojiDigitMatch[1]) {
      const n = Number(emojiDigitMatch[1]);
      if (n >= 1 && n <= max) return n;
    }

    // Ordinais escritos
    const ordinals: Record<string, number> = {
      primeira: 1,
      primeiro: 1,
      segunda: 2,
      segundo: 2,
      terceira: 3,
      terceiro: 3,
      quarta: 4,
      quarto: 4,
    };
    for (const [word, n] of Object.entries(ordinals)) {
      if (n <= max && new RegExp(`\\b${word}\\b`).test(norm)) return n;
    }

    // Número escrito ("um", "dois", "tres")
    const written: Record<string, number> = {
      um: 1,
      uma: 1,
      dois: 2,
      duas: 2,
      tres: 3,
    };
    for (const [word, n] of Object.entries(written)) {
      if (n <= max && new RegExp(`\\b${word}\\b`).test(norm)) return n;
    }

    // Dígito isolado — match em "[1-9]" cercado por non-digit (não pega "12h")
    const digitMatches = norm.match(/(?:^|\D)([1-9])(?:\D|$)/g);
    if (digitMatches) {
      const numbers = digitMatches
        .map((m) => Number(m.replace(/\D/g, '')))
        .filter((n) => n >= 1 && n <= max);
      // Se múltiplos dígitos válidos, ambíguo → null
      if (numbers.length === 1 && numbers[0] !== undefined) return numbers[0];
    }

    return null;
  }

  /**
   * Lead já recebeu proposta de slots e mandou nova mensagem. Tenta
   * interpretar como escolha. Se sim → cria appointment + confirma. Se
   * não → re-pergunta (até MAX_SLOT_CHOICE_RETRIES) e depois transfere
   * pro humano (transição pra routed sem criar nada).
   */
  private async handleSlotChoice(args: {
    orgId: string;
    conversationId: string;
    conversation: ConversationRow;
    messageText: string;
    settings: ConciergeSettings;
    persona: AiAgentPersona;
  }): Promise<void> {
    const { orgId, conversationId, conversation, messageText, settings, persona } = args;

    const meta = (conversation.metadata as { scheduling?: SchedulingMetadata } | null)?.scheduling;
    if (!meta || !Array.isArray(meta.offered_slots) || meta.offered_slots.length === 0) {
      this.logger.warn(
        `concierge: state=awaiting_slot_choice mas conversation.metadata.scheduling vazio — transferindo pra humano`,
      );
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    const max = meta.offered_slots.length;
    const pick = this.parseSlotChoice(messageText, max);

    if (pick !== null) {
      const chosen = meta.offered_slots.find((o) => o.index === pick);
      if (!chosen) {
        this.logger.warn(`concierge: pick=${pick} fora dos offered_slots`);
        await this.setConciergeState(orgId, conversationId, 'routed');
        return;
      }

      // Re-valida slot — pode ter sido ocupado por outro fluxo entre a
      // proposta e a escolha. Se conflitar, pede pro lead reenviar com
      // novo conjunto de slots.
      const stillFree = await this.isSlotStillFree(orgId, chosen);
      if (!stillFree) {
        this.logger.log(
          `concierge: slot escolhido (${chosen.start_time}) foi ocupado entre proposta e escolha — re-propondo`,
        );
        if (settings.auto_reply) {
          await this.applyResponseDelay(persona);
          await this.sendOutbound(
            orgId,
            conversation,
            'Desculpe, esse horário acabou de ser preenchido. Vou checar outras opções e já te retorno!',
          );
        }
        // Re-tenta proposta
        const ok = await this.proposeSlotsAndPersist({
          orgId,
          conversationId,
          conversation,
          persona,
          specialty: meta.specialty,
          bridgeMessage: null,
          originMessage: meta.origin_message,
        });
        if (!ok) {
          await this.setConciergeState(orgId, conversationId, 'routed');
        }
        return;
      }

      // Tudo certo — cria o appointment via AppointmentsService
      try {
        await this.appointments.create(
          orgId,
          {
            title: `Atendimento — ${meta.specialty ?? 'Geral'}`,
            description: `Agendado pelo Concierge IA via WhatsApp.\nMensagem original: "${meta.origin_message.slice(0, 200)}"`,
            start_time: chosen.start_time,
            end_time: chosen.end_time,
            assigned_to: chosen.agent_id,
            contact_id: conversation.contact_id,
            conversation_id: conversation.id,
            metadata: {
              source: 'ai_concierge',
              specialty_guess: meta.specialty,
              proposed_at: meta.proposed_at,
            },
          },
          true, // createdByAi
        );
      } catch (err) {
        this.logger.warn(
          `concierge: appointments.create falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
        if (settings.auto_reply) {
          await this.applyResponseDelay(persona);
          await this.sendOutbound(
            orgId,
            conversation,
            'Tive um probleminha pra confirmar o horário aqui. Nossa equipe vai te chamar em instantes!',
          );
        }
        await this.setConciergeState(orgId, conversationId, 'routed');
        return;
      }

      // Confirma pro lead
      const dayFmt = new Intl.DateTimeFormat('pt-BR', {
        weekday: 'long',
        day: '2-digit',
        month: 'long',
        timeZone: 'America/Sao_Paulo',
      });
      const timeFmt = new Intl.DateTimeFormat('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'America/Sao_Paulo',
      });
      const d = new Date(chosen.start_time);
      const dayLabel = dayFmt.format(d);
      const timeLabel = timeFmt.format(d);
      const agentSuffix = chosen.agent_name ? ` com ${chosen.agent_name}` : '';
      const confirmText = `Pronto! ✅ Agendamento confirmado pra ${dayLabel} às ${timeLabel}${agentSuffix}. Te lembramos antes pra você não esquecer.`;

      if (settings.auto_reply) {
        await this.applyResponseDelay(persona);
        await this.sendOutbound(orgId, conversation, confirmText);
      }

      // Limpa scheduling do metadata + transiciona pra routed
      await this.updateConciergeMetadata(orgId, conversationId, {
        concierge_state: 'routed',
        scheduling: null, // remove a oferta consumida
        last_appointment_created_at: new Date().toISOString(),
      });

      this.logger.log(
        `concierge: appointment criado conv=${conversationId} pick=${pick} agent=${chosen.agent_id} start=${chosen.start_time}`,
      );
      return;
    }

    // Não conseguiu parsear — incrementa retries. Se passou do limite,
    // entrega pro humano (transferência silenciosa pra atendente revisar).
    const retries = (meta.retries ?? 0) + 1;
    if (retries > MAX_SLOT_CHOICE_RETRIES) {
      this.logger.log(
        `concierge: ${MAX_SLOT_CHOICE_RETRIES} tentativas sem escolha clara conv=${conversationId} — entregando pra humano`,
      );
      if (settings.auto_reply) {
        await this.applyResponseDelay(persona);
        await this.sendOutbound(
          orgId,
          conversation,
          'Sem problemas! Vou pedir pra equipe te chamar pra alinhar o melhor horário. Já já alguém te responde por aqui!',
        );
      }
      await this.updateConciergeMetadata(orgId, conversationId, {
        concierge_state: 'routed',
        scheduling: null,
      });
      return;
    }

    // Re-pergunta
    if (settings.auto_reply) {
      const list = this.formatSlotsForUser(meta.offered_slots);
      const text = `Não entendi qual você prefere. Pode me responder só com o número (${meta.offered_slots.map((o) => o.index).join(', ')})?\n\n${list}`;
      await this.applyResponseDelay(persona);
      await this.sendOutbound(orgId, conversation, text);
    }
    await this.updateConciergeMetadata(orgId, conversationId, {
      scheduling: { ...meta, retries },
    });
  }

  /**
   * Confere se o slot escolhido ainda está livre (alguém pode ter
   * agendado entre a proposta e a escolha). Best-effort: query simples
   * em appointments com overlap por agente.
   */
  private async isSlotStillFree(orgId: string, slot: OfferedSlot): Promise<boolean> {
    const { data } = await this.supabase.adminClient
      .from('appointments')
      .select('id')
      .eq('org_id', orgId)
      .eq('assigned_to', slot.agent_id)
      .in('status', ['scheduled', 'confirmed'])
      .lt('start_time', slot.end_time)
      .gt('end_time', slot.start_time)
      .limit(1);
    return !data || data.length === 0;
  }

  // ──────────────────────────────────────────────────────────
  // Outbound — envia mensagem pelo canal da conversa
  // ──────────────────────────────────────────────────────────

  private async sendOutbound(
    orgId: string,
    conversation: ConversationRow,
    text: string,
  ): Promise<void> {
    if (!conversation.channel_id) {
      this.logger.warn(
        `concierge: conversa ${conversation.id} sem channel_id — não envia`,
      );
      return;
    }

    // Persiste a mensagem outbound como sender_type=bot. Retornamos id +
    // created_at — created_at é necessário pro partition pruning no UPDATE
    // de status (active.messages é PARTITION BY RANGE created_at).
    const { data: persisted, error: persistErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: orgId,
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_type: 'bot',
        content_type: 'text',
        content: { body: text },
        plain_text: text,
        status: 'pending',
        metadata: { source: 'ai_concierge' },
      })
      .select('id, created_at')
      .single();

    if (persistErr || !persisted) {
      this.logger.warn(
        `concierge: persist outbound falhou: ${persistErr?.message ?? 'sem dados'}`,
      );
      return;
    }
    const { id: messageId, created_at: messageCreatedAt } = persisted as {
      id: string;
      created_at: string;
    };

    try {
      const result = await this.dispatcher.send({
        org_id: orgId,
        channel_id: conversation.channel_id,
        contact_id: conversation.contact_id,
        content_type: 'text',
        content: { body: text },
      });
      const { error: updErr } = await this.supabase.adminClient
        .from('messages')
        .update({
          status: 'sent',
          channel_message_id: result.channel_message_id,
        })
        .eq('org_id', orgId)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
      if (updErr) {
        this.logger.warn(`concierge: mark sent falhou: ${updErr.message}`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`concierge: dispatch falhou: ${msg}`);
      const { error: updErr } = await this.supabase.adminClient
        .from('messages')
        .update({
          status: 'failed',
          error_code: 'concierge_dispatch_error',
          error_message: msg,
        })
        .eq('org_id', orgId)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
      if (updErr) {
        this.logger.warn(`concierge: mark failed falhou: ${updErr.message}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Loaders
  // ──────────────────────────────────────────────────────────

  private async loadSettings(orgId: string): Promise<ConciergeSettings> {
    const { data } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();

    const all = (data?.settings as Record<string, unknown> | null) ?? {};
    const ai = (all.ai_concierge as Partial<ConciergeSettings> | undefined) ?? {};
    return {
      enabled: ai.enabled === true,
      auto_reply: ai.auto_reply === true,
      send_bridge_message: ai.send_bridge_message !== false, // default true
      business_context: typeof ai.business_context === 'string' ? ai.business_context : '',
    };
  }

  private async loadConversation(
    orgId: string,
    conversationId: string,
  ): Promise<ConversationRow | null> {
    const { data } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, channel_id, metadata')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();
    return (data as ConversationRow | null) ?? null;
  }

  private async loadMessage(
    orgId: string,
    messageId: string,
  ): Promise<{ direction: string; plain_text: string | null } | null> {
    const { data } = await this.supabase.adminClient
      .from('messages')
      .select('direction, plain_text')
      .eq('org_id', orgId)
      .eq('id', messageId)
      .maybeSingle();
    return (data as { direction: string; plain_text: string | null } | null) ?? null;
  }

  private async fetchContactName(
    orgId: string,
    contactId: string,
  ): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('contacts')
      .select('name')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();
    const name = (data as { name: string | null } | null)?.name?.trim();
    return name && name.length > 0 ? name : null;
  }

  private async loadPipelines(orgId: string): Promise<PipelineWithStages[]> {
    const { data: pipes } = await this.supabase.adminClient
      .from('pipelines')
      .select('id, name, description, is_default')
      .eq('org_id', orgId)
      .is('archived_at', null)
      .order('is_default', { ascending: false })
      .order('name');

    const pipelines = (pipes ?? []) as Array<{
      id: string;
      name: string;
      description: string | null;
      is_default: boolean;
    }>;

    if (pipelines.length === 0) return [];

    const ids = pipelines.map((p) => p.id);
    const { data: stagesData } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, pipeline_id, name, description, position, is_won, is_lost')
      .in('pipeline_id', ids)
      .order('position');

    const stages = (stagesData ?? []) as Array<{
      id: string;
      pipeline_id: string;
      name: string;
      description: string | null;
      position: number;
      is_won: boolean;
      is_lost: boolean;
    }>;

    return pipelines.map((p) => ({
      ...p,
      stages: stages
        .filter((s) => s.pipeline_id === p.id)
        .map(({ pipeline_id: _ignore, ...rest }) => rest),
    }));
  }

  private async loadHistory(
    orgId: string,
    conversationId: string,
  ): Promise<HistoryItem[]> {
    const { data } = await this.supabase.adminClient
      .from('messages')
      .select('direction, plain_text')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .not('plain_text', 'is', null)
      .order('created_at', { ascending: false })
      .limit(HISTORY_MAX_MESSAGES);
    const rows = (data ?? []) as Array<{
      direction: string;
      plain_text: string | null;
    }>;
    return rows
      .reverse()
      .map((r) => ({
        direction: r.direction === 'inbound' ? 'inbound' : 'outbound',
        text: (r.plain_text ?? '').slice(0, 400),
      }));
  }

  // ──────────────────────────────────────────────────────────
  // State helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Merge shallow num conjunto de chaves no JSONB metadata (fetch+update,
   * não-atômico — ok pra MVP). Usado tanto pra state quanto pra contadores
   * de qualificação.
   */
  private async updateConciergeMetadata(
    orgId: string,
    conversationId: string,
    patch: Record<string, unknown>,
  ): Promise<void> {
    const { data } = await this.supabase.adminClient
      .from('conversations')
      .select('metadata')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();

    const current = (data?.metadata as Record<string, unknown> | null) ?? {};
    const next = { ...current, ...patch };
    await this.supabase.adminClient
      .from('conversations')
      .update({ metadata: next })
      .eq('org_id', orgId)
      .eq('id', conversationId);
  }

  private async setConciergeState(
    orgId: string,
    conversationId: string,
    state: ConciergeState,
  ): Promise<void> {
    return this.updateConciergeMetadata(orgId, conversationId, {
      concierge_state: state,
    });
  }

  private tonePt(tone: AiPersonaTone | undefined): string {
    switch (tone) {
      case 'formal':
        return 'formal e respeitoso';
      case 'semiformal':
        return 'profissional mas próximo';
      case 'casual':
        return 'descontraído';
      case 'friendly':
        return 'caloroso e empático';
      default:
        return 'profissional e amigável';
    }
  }
}

interface ConversationRow {
  id: string;
  contact_id: string;
  channel_id: string | null;
  metadata: Record<string, unknown> | null;
}

interface HistoryItem {
  direction: 'inbound' | 'outbound';
  text: string;
}
