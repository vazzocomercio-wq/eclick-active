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

const SONNET_MODEL_ID = 'claude-sonnet-4-6';
const HISTORY_MAX_MESSAGES = 6;

/** Limite de delay por humanização — evita persona com delay maluco travar request */
const MAX_DELAY_MS = 30_000;

/** Pricing Sonnet 4.6 (USD por milhão de tokens) — pra calcular custo log */
const SONNET_INPUT_PER_MTOK = 3.0;
const SONNET_OUTPUT_PER_MTOK = 15.0;

type ConciergeState = 'idle' | 'awaiting_response' | 'routed';

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

interface RouteDecision {
  pipeline_id: string;
  stage_id: string;
  intent_label: string;
  temperature: ContactTemperature;
  bridge_message: string | null;
  reasoning: string;
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

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly persona: AiPersonaService,
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
    const start = performance.now();
    try {
      const settings = await this.loadSettings(orgId);
      if (!settings.enabled) return;

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

      const personaActive = await this.persona.getDefault(orgId).catch(() => null);
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
      }

      this.logger.debug(
        `concierge done state=${state} conv=${conversationId} took=${Math.round(performance.now() - start)}ms`,
      );
    } catch (err) {
      this.logger.error(
        `concierge handler crashed (não fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
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
      // Interpola {{contact.name}} se houver
      const name = await this.fetchContactName(orgId, conversation.contact_id);
      greeting = customGreeting.replaceAll('{{contact.name}}', name ?? '');
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
    interactionType: 'concierge_greeting' | 'concierge_route';
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

    // 1. Carrega pipelines com stages
    const pipelines = await this.loadPipelines(orgId);
    if (pipelines.length === 0) {
      this.logger.warn(`concierge: org ${orgId} sem pipelines — não pode rotear`);
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    // 2. Carrega histórico curto pra IA ter contexto
    const history = await this.loadHistory(orgId, conversationId);

    // 3. IA decide pipeline + stage + bridge message
    const decision = await this.askIaToRoute({
      pipelines,
      history,
      latestMessage: messageText,
      persona,
      businessContext: settings.business_context,
    });

    if (!decision) {
      this.logger.warn(
        `concierge: IA não conseguiu decidir rota pra conv ${conversationId}`,
      );
      await this.setConciergeState(orgId, conversationId, 'routed');
      return;
    }

    // Log da chamada IA de roteamento (custo + tokens)
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
        },
      });
    }

    // 4. Cria deal nesse pipeline+stage (se contato ainda não tem deal ativo)
    const dealCreated = await this.createDealIfMissing({
      orgId,
      contactId: conversation.contact_id,
      pipelineId: decision.pipeline_id,
      stageId: decision.stage_id,
      reasoning: decision.reasoning,
      intentLabel: decision.intent_label,
    });

    // 5. Atualiza temperatura do contato
    if (decision.temperature) {
      await this.supabase.adminClient
        .from('contacts')
        .update({ temperature: decision.temperature })
        .eq('org_id', orgId)
        .eq('id', conversation.contact_id);
    }

    // 6. Bridge message — se IA gerou e setting ligado
    if (
      settings.send_bridge_message &&
      settings.auto_reply &&
      decision.bridge_message
    ) {
      await this.applyResponseDelay(persona);
      await this.sendOutbound(orgId, conversation, decision.bridge_message);
    }

    await this.setConciergeState(orgId, conversationId, 'routed');

    this.logger.log(
      `concierge: roteou conv=${conversationId} → pipeline=${decision.pipeline_id} stage=${decision.stage_id} intent=${decision.intent_label} temp=${decision.temperature} deal_created=${dealCreated}`,
    );
  }

  private async askIaToRoute(args: {
    pipelines: PipelineWithStages[];
    history: HistoryItem[];
    latestMessage: string;
    persona: AiAgentPersona;
    businessContext: string;
  }): Promise<RouteDecision | null> {
    const { pipelines, history, latestMessage, persona, businessContext } = args;

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

    const system = `Você é um sistema de roteamento inteligente de leads para um CRM. Sua tarefa: ler a conversa, classificar a intenção do cliente e decidir QUAL pipeline e stage do CRM é o melhor encaixe.

CONTEXTO DA EMPRESA:
${businessContext || '(sem contexto detalhado)'}

PIPELINES DISPONÍVEIS NESTA ORG (você DEVE escolher um):
${pipelinesText}

PERSONA QUE INTERAGE COM O CLIENTE: ${persona.name} (${persona.role ?? 'assistant'}, tom ${tonePt})

REGRAS:
1. Escolha O ID do pipeline que faz mais sentido pra esse lead, baseado nas descrições.
2. Escolha O ID de UM stage DISPONÍVEL desse pipeline (não pode ser de outro pipeline).
3. Classifique a temperatura do lead: "cold" (curiosidade), "warm" (interesse genuíno), "hot" (pronto pra comprar), "very_hot" (urgência/objeção próxima).
4. Dê um intent_label curto descritivo (ex: "interesse_planos_premium", "duvida_tecnica", "reclamacao_produto").
5. Gere um "bridge_message" CURTO (1-2 frases, máx 200 chars) no tom ${tonePt} pra avisar o cliente da próxima etapa. NULL se não fizer sentido enviar nada.
6. "reasoning": frase curta explicando POR QUE escolheu esse pipeline.

Retorne APENAS JSON puro com este shape exato:
{
  "pipeline_id": "<uuid>",
  "stage_id": "<uuid>",
  "intent_label": "<string>",
  "temperature": "cold|warm|hot|very_hot",
  "bridge_message": "<string ou null>",
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
      if (!d.pipeline_id || !d.stage_id || !d.intent_label || !d.temperature) {
        this.logger.warn(`concierge IA retornou JSON incompleto: ${cleaned.slice(0, 200)}`);
        return null;
      }

      // Validação: o stage_id pertence ao pipeline_id?
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

      return {
        pipeline_id: d.pipeline_id,
        stage_id: d.stage_id,
        intent_label: d.intent_label,
        temperature: d.temperature as ContactTemperature,
        bridge_message:
          typeof d.bridge_message === 'string' && d.bridge_message.trim()
            ? d.bridge_message.trim()
            : null,
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

  private async createDealIfMissing(args: {
    orgId: string;
    contactId: string;
    pipelineId: string;
    stageId: string;
    reasoning: string;
    intentLabel: string;
  }): Promise<boolean> {
    const { orgId, contactId, pipelineId, stageId, reasoning, intentLabel } = args;

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
    if (existing) return false;

    // Pega nome do contato pra title do deal
    const contactName = await this.fetchContactName(orgId, contactId);

    // Tabela deals não tem colunas `source` nem `metadata` no schema —
    // usamos `tags` (text[]) + `custom_fields` (jsonb) que já existem
    // e seguem o padrão usado em `auto-lead.service.ts`. Sem isso o
    // INSERT falhava com 42703 (column does not exist) e o Concierge
    // marcava state=routed sem deal criado.
    const { error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        pipeline_id: pipelineId,
        stage_id: stageId,
        title: contactName ?? 'Novo lead',
        tags: ['ai-concierge'],
        custom_fields: {
          ai_concierge: {
            intent_label: intentLabel,
            reasoning,
            routed_at: new Date().toISOString(),
          },
        },
      });

    if (error) {
      this.logger.warn(`concierge: insert deal falhou: ${error.message}`);
      return false;
    }
    return true;
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

  private async setConciergeState(
    orgId: string,
    conversationId: string,
    state: ConciergeState,
  ): Promise<void> {
    // Merge no JSONB metadata via fetch + update (Supabase JS não tem `||`
    // direto). Pra evitar race entre handlers concorrentes, ok pra MVP.
    const { data } = await this.supabase.adminClient
      .from('conversations')
      .select('metadata')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();

    const current = (data?.metadata as Record<string, unknown> | null) ?? {};
    const next = { ...current, concierge_state: state };
    await this.supabase.adminClient
      .from('conversations')
      .update({ metadata: next })
      .eq('org_id', orgId)
      .eq('id', conversationId);
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
