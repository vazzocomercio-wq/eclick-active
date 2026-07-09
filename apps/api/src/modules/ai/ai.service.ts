import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Deal, DealActivity, Json, Message } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LiveSourcesService } from '../knowledge/live-sources.service';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import { AiSkillsService } from '../ai-skills/ai-skills.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { AnthropicClient } from './anthropic.client';
import { AiConciergeService } from './ai-concierge.service';
import { DataCollectionService } from './data-collection.service';
import { ProductInterestService } from './product-interest.service';
import { SacAiService } from '../sac/sac-ai.service';
import { SacTicketsService } from '../sac/sac-tickets.service';
import type { AiSkill } from '@eclick-active/shared';
import {
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  ClassificationResult,
  DEAL_SCORE_SCHEMA,
  DEAL_SCORE_SYSTEM_PROMPT,
  DealScoreResult,
  FUNNEL_ANALYSIS_SCHEMA,
  FUNNEL_ANALYSIS_SYSTEM_PROMPT,
  FunnelAnalysisResult,
  GAPS_SCHEMA,
  GAPS_SYSTEM_PROMPT,
  GapsResult,
  SCHEDULING_INTENT_SCHEMA,
  SCHEDULING_INTENT_SYSTEM_PROMPT,
  SchedulingIntentResult,
  SUGGEST_SCHEMA,
  SUGGEST_SYSTEM_PROMPT,
  SUMMARIZE_SYSTEM_PROMPT,
  SuggestionResult,
} from './ai.types';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly anthropic: AnthropicClient,
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly knowledge: KnowledgeService,
    private readonly liveSources: LiveSourcesService,
    private readonly persona: AiPersonaService,
    private readonly skills: AiSkillsService,
    private readonly dataCollection: DataCollectionService,
    private readonly appointmentsLookup: AppointmentsService,
    private readonly concierge: AiConciergeService,
    private readonly sacAi: SacAiService,
    private readonly sacTickets: SacTicketsService,
    private readonly productInterest: ProductInterestService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // a) classifyMessage
  // ──────────────────────────────────────────────────────────

  /**
   * Classifica uma mensagem inbound usando contexto da conversa, persiste
   * resultado em messages.ai_intent/ai_sentiment + messages.metadata e
   * propaga pra conversation (intent/sentiment/temperature) e contact
   * (temperature) quando muda. Loga em ai_interactions.
   */
  async classifyMessage(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ClassificationResult> {
    const message = await this.fetchMessage(orgId, messageId);
    const conversation = await this.fetchConversationCore(orgId, conversationId);
    const recent = await this.fetchRecentMessages(orgId, conversationId, 10);

    const userPrompt = this.buildClassifyPrompt(message, recent);

    const { data: classification } = await this.anthropic.complete<ClassificationResult>({
      interaction_type: 'classify_intent',
      org_id: orgId,
      system: CLASSIFY_SYSTEM_PROMPT,
      user: userPrompt,
      schema: CLASSIFY_SCHEMA,
      max_tokens: 512,
      context: {
        conversation_id: conversationId,
        contact_id: conversation.contact_id ?? undefined,
      },
    });

    await this.persistClassification(orgId, message, conversation, classification);

    // Auto-classificação SAC: se intent indica pós-venda/suporte/reclamação
    // E mensagem contém palavras-chave, dispara fluxo SAC em paralelo (não bloqueia).
    void this.maybeCreateSacTicket(orgId, conversationId, message, classification).catch(
      (err) => {
        this.logger.warn(
          `SAC auto-classify falhou (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      },
    );

    return classification;
  }

  /**
   * Detecta se a mensagem é candidata a virar ticket SAC e cria
   * automaticamente quando confidence > 0.7. Idempotente: se já há ticket
   * aberto pra essa conversa, não recria.
   */
  private async maybeCreateSacTicket(
    orgId: string,
    conversationId: string,
    message: Message,
    classification: ClassificationResult,
  ): Promise<void> {
    const SAC_INTENTS = new Set(['complaint', 'support', 'other']);
    const SAC_KEYWORDS =
      /(pedido|entrega|atraso|atras[ao]u|defeito|defeituoso|troca|devolu[çc][ãa]o|devolver|reembolso|garantia|cancelar|reclama|nota fiscal|rastreio|rastreamento|extravio|perdeu|n[ãa]o chegou|estornar|nf-?e)/i;

    const intent = (classification.intent ?? '').toLowerCase();
    if (!SAC_INTENTS.has(intent)) return;

    const text = message.plain_text ?? this.extractText(message.content);
    if (!text || !SAC_KEYWORDS.test(text)) return;

    // Idempotência: se já há ticket aberto pra essa conversa, sai
    const existing = await this.sacTickets.findOpenByConversation(orgId, conversationId);
    if (existing) return;

    // Histórico recente como contexto pra IA
    const recent = await this.fetchRecentMessages(orgId, conversationId, 6);
    const history = recent
      .reverse()
      .map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Atendente'}: ${m.plain_text ?? ''}`)
      .filter((s) => s.length > 5);

    // Busca contato pra enriquecer com dados de pedido (bridge)
    const conv = await this.fetchConversationCore(orgId, conversationId);
    let contactRefs: { phone?: string | null; email?: string | null } = {};
    if (conv.contact_id) {
      const { data: c } = await this.supabase.adminClient
        .from('contacts')
        .select('phone, email')
        .eq('id', conv.contact_id)
        .eq('org_id', orgId)
        .maybeSingle();
      if (c) contactRefs = c as { phone?: string | null; email?: string | null };
    }

    const sac = await this.sacAi.classifyTicket(orgId, text, history, contactRefs);
    if (!sac || sac.confidence < 0.7) return;

    try {
      await this.sacTickets.createFromConversation(orgId, conversationId, sac);
    } catch (err) {
      this.logger.warn(
        `createFromConversation falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Extrai string do `content: Json`. Aceita string direta ou objeto com .text/.body. */
  private extractText(content: Json | null | undefined): string {
    if (!content) return '';
    if (typeof content === 'string') return content;
    if (typeof content === 'object' && content !== null) {
      const obj = content as Record<string, unknown>;
      if (typeof obj.text === 'string') return obj.text;
      if (typeof obj.body === 'string') return obj.body;
      if (typeof obj.message === 'string') return obj.message;
    }
    return '';
  }

  // ──────────────────────────────────────────────────────────
  // b) suggestResponse
  // ──────────────────────────────────────────────────────────

  /**
   * Gera sugestão de resposta pra o vendedor com base nas últimas 15
   * mensagens + perfil do contato. Não persiste em lugar nenhum (a UI
   * exibe via WebSocket; o agente decide se usa).
   */
  async suggestResponse(
    orgId: string,
    conversationId: string,
  ): Promise<
    SuggestionResult & {
      ai_interaction_id: string | null;
      live_sources_used: Array<{ id: string; name: string; url: string }>;
    }
  > {
    const conversation = await this.fetchConversationCore(orgId, conversationId);
    const contact = conversation.contact_id
      ? await this.fetchContactSummary(orgId, conversation.contact_id)
      : null;
    const recent = await this.fetchRecentMessages(orgId, conversationId, 15);

    // Busca contexto relevante na base de conhecimento usando as últimas
    // 3 mensagens do cliente como query. Falha graciosamente se OPENAI_API_KEY
    // não estiver configurada — searchSemantic retorna [].
    const knowledgeQuery = recent
      .filter((m) => m.direction === 'inbound')
      .slice(-3)
      .map((m) => m.plain_text ?? '')
      .filter(Boolean)
      .join(' ')
      .slice(0, 500);
    const knowledgeHits = knowledgeQuery
      ? await this.knowledge.searchSemantic(orgId, knowledgeQuery, 3)
      : [];

    // Resolve skill ativo pra essa mensagem (Bloco F)
    const personaDefault = await this.persona.getDefault(orgId).catch(() => null);
    const lastInbound = [...recent].reverse().find((m) => m.direction === 'inbound') ?? null;
    let activeSkill: AiSkill | null = null;
    if (personaDefault && lastInbound) {
      activeSkill = await this.skills
        .resolveSkillForMessage({
          orgId,
          persona: personaDefault,
          message: {
            ai_intent: lastInbound.ai_intent,
            ai_sentiment: lastInbound.ai_sentiment,
            plain_text: lastInbound.plain_text,
          },
          contact: contact ? { temperature: contact.temperature } : null,
        })
        .catch(() => null);
    }

    // Se há skill, busca KB com prioridade de docs específicos do skill
    const skillKnowledgeHits =
      activeSkill && (activeSkill.knowledge_source_ids.length > 0 || activeSkill.knowledge_categories.length > 0)
        ? await this.knowledge
            .searchSemanticForSkill(orgId, knowledgeQuery, {
              source_ids: activeSkill.knowledge_source_ids,
              categories: activeSkill.knowledge_categories,
              intent: lastInbound?.ai_intent ?? null,
            })
            .catch(() => knowledgeHits)
        : knowledgeHits;

    // Live sources (Feature B): consulta fontes URL em tempo real quando o
    // RAG local devolve poucos hits OU similaridade média baixa. Best-effort:
    // erros e timeouts não quebram a sugestão.
    let liveContent: string | null = null;
    let liveSourcesUsed: Array<{ id: string; name: string; url: string }> = [];
    if (knowledgeQuery && lastInbound) {
      const lowResults = skillKnowledgeHits.length < 2;
      const lowSim =
        skillKnowledgeHits.length > 0 &&
        skillKnowledgeHits.reduce((s, h) => s + h.similarity, 0) / skillKnowledgeHits.length < 0.55;
      if (lowResults || lowSim) {
        const live = await this.liveSources
          .fetchLiveContent(orgId, knowledgeQuery)
          .catch(() => null);
        if (live) {
          liveContent = live.content;
          liveSourcesUsed = live.sources_used;
        }
      }
    }

    // Vendedora IA (Fase B) — produto de interesse do anúncio (bridge
    // v_saas_products). Gate heurístico + single-flight ficam dentro do
    // detect (Haiku tier cheap só quando a msg cita produto). FAIL-OPEN:
    // erro nunca quebra a sugestão — segue sem o bloco.
    let productBlock = '';
    try {
      const interest = await this.productInterest.detect({
        orgId,
        conversationId,
        latestText: lastInbound?.plain_text ?? '',
        recentMessages: recent
          .slice(-4)
          .map((m) => ({
            direction: m.direction === 'inbound' ? ('inbound' as const) : ('outbound' as const),
            text: (m.plain_text ?? '').slice(0, 200),
          })),
      });
      productBlock = this.productInterest.buildPromptBlock(interest);
    } catch (err) {
      this.logger.warn(
        `suggestResponse: product-interest falhou (segue sem produto): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const userPrompt = this.buildSuggestPrompt(
      contact,
      recent,
      skillKnowledgeHits,
      liveContent,
      productBlock,
    );

    // System prompt: persona + skill (se houver) + SUGGEST_SYSTEM_PROMPT
    const parts: string[] = [];
    if (personaDefault) parts.push(this.persona.buildSystemPrompt(personaDefault));
    if (activeSkill) {
      parts.push(`SKILL ATIVO: ${activeSkill.name}\n${activeSkill.description}\n\n${activeSkill.system_prompt}`);
    }
    parts.push(SUGGEST_SYSTEM_PROMPT);
    const systemPrompt = parts.join('\n\n---\n\n');

    const { data: suggestion, interaction_id } = await this.anthropic.complete<SuggestionResult>({
      interaction_type: 'suggest_response',
      org_id: orgId,
      system: systemPrompt,
      user: userPrompt,
      schema: SUGGEST_SCHEMA,
      max_tokens: 768,
      context: {
        conversation_id: conversationId,
        contact_id: conversation.contact_id ?? undefined,
      },
    });

    // Stats: registra execução do skill
    if (activeSkill) {
      const conf = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));
      void this.skills.recordExecution(activeSkill.id, conf).catch(() => {});
    }

    // Auto-escalation: se confidence baixa, cria tarefa pra humano (Bloco G PARTE 3)
    const confidence0to1 = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));
    void this.maybeEscalate(orgId, conversationId, {
      confidence: confidence0to1,
      intent: lastInbound?.ai_intent ?? null,
      contactName: contact?.name ?? null,
      messageText: lastInbound?.plain_text ?? '',
      suggestedResponse: suggestion.suggested_response,
      knowledgeSourcesCount: skillKnowledgeHits.length,
    }).catch((err) => {
      this.logger.warn(
        `auto-escalation failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Clamp confidence em [0, 1] — schema não permite minimum/maximum
    const confidence = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));

    return {
      ...suggestion,
      confidence,
      ai_interaction_id: interaction_id,
      live_sources_used: liveSourcesUsed,
    };
  }

  // ──────────────────────────────────────────────────────────
  // Auto-escalation (Bloco G PARTE 3)
  // ──────────────────────────────────────────────────────────

  /**
   * Quando a confiança da IA é baixa, cria tarefa urgente pro responsável
   * humano revisar a conversa antes de qualquer resposta automática.
   *
   * Settings em ai_feature_settings.feature_name='auto_escalation':
   *   - confidence_threshold (default 60 — em %)
   *   - create_task (default true)
   *   - notify_agent (default true)
   *   - block_auto_respond (default true — usado pelo webhook)
   */
  private async maybeEscalate(
    orgId: string,
    conversationId: string,
    args: {
      confidence: number;
      intent: string | null;
      contactName: string | null;
      messageText: string;
      suggestedResponse: string;
      knowledgeSourcesCount: number;
    },
  ): Promise<void> {
    // Carrega config
    const { data: setting } = await this.supabase.adminClient
      .from('ai_feature_settings')
      .select('enabled, config')
      .eq('org_id', orgId)
      .eq('feature_name', 'auto_escalation')
      .maybeSingle();
    if (!setting || !(setting as { enabled: boolean }).enabled) return;

    const config = (((setting as { config: Record<string, unknown> }).config) ?? {}) as {
      confidence_threshold?: number;
      create_task?: boolean;
      notify_agent?: boolean;
      block_auto_respond?: boolean;
    };
    const threshold = (config.confidence_threshold ?? 60) / 100;
    if (args.confidence >= threshold) return;

    // Resolve assigned_to (conversation > deal > round-robin)
    const { data: convData } = await this.supabase.adminClient
      .from('conversations')
      .select('assigned_to, contact_id')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();
    let assignedTo = (convData as { assigned_to: string | null } | null)?.assigned_to ?? null;
    const contactId = (convData as { contact_id: string | null } | null)?.contact_id ?? null;

    if (!assignedTo && contactId) {
      const { data: dealData } = await this.supabase.adminClient
        .from('deals')
        .select('assigned_to')
        .eq('org_id', orgId)
        .eq('contact_id', contactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      assignedTo = (dealData as { assigned_to: string | null } | null)?.assigned_to ?? null;
    }

    if (!assignedTo) {
      // Round-robin simples — pega primeiro agente ativo
      const { data: members } = await this.supabase.adminClient
        .from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('role', ['owner', 'admin', 'agent'])
        .limit(1);
      assignedTo = ((members ?? [])[0] as { user_id: string } | undefined)?.user_id ?? null;
    }

    if (!assignedTo) return;

    const confidencePct = Math.round(args.confidence * 100);
    const truncatedQuestion = args.messageText.slice(0, 100) + (args.messageText.length > 100 ? '…' : '');

    if (config.create_task !== false) {
      const dueDate = new Date(Date.now() + 30 * 60_000).toISOString();
      const priority = args.confidence < 0.3 ? 'urgent' : 'high';

      await this.supabase.adminClient
        .from('tasks')
        .insert({
          org_id: orgId,
          title: `IA precisa de ajuda: ${args.contactName ?? 'cliente'}`,
          description: `Cliente perguntou: "${truncatedQuestion}"\n\nA IA não tem certeza da resposta (confiança: ${confidencePct}%). Revise antes de enviar.\n\nResposta que a IA geraria:\n${args.suggestedResponse}`,
          task_type: 'follow_up',
          priority,
          status: 'pending',
          assigned_to: assignedTo,
          conversation_id: conversationId,
          contact_id: contactId,
          created_by_ai: true,
          ai_context: `Confidence: ${confidencePct}%. Intent: ${args.intent ?? 'unknown'}. Knowledge sources: ${args.knowledgeSourcesCount}`,
          due_date: dueDate,
        })
        .then(() => {})
        .then(undefined, () => {});
    }

    if (config.notify_agent !== false) {
      await this.supabase.adminClient
        .from('notifications')
        .insert({
          org_id: orgId,
          user_id: assignedTo,
          type: 'ai_low_confidence',
          severity: args.confidence < 0.3 ? 'urgent' : 'warning',
          title: 'IA precisa de ajuda',
          body: `${args.contactName ?? 'Cliente'} fez uma pergunta com baixa confiança da IA (${confidencePct}%)`,
          link: `/conversas?id=${conversationId}`,
          metadata: {
            conversation_id: conversationId,
            confidence: confidencePct,
            intent: args.intent,
          },
        })
        .then(() => {})
        .then(undefined, () => {});
    }
  }

  // ──────────────────────────────────────────────────────────
  // c) summarizeConversation
  // ──────────────────────────────────────────────────────────

  /**
   * Gera resumo de 2-3 frases e atualiza conversation.ai_summary.
   * Output é texto livre (sem json_schema) — mais natural pro modelo.
   */
  async summarizeConversation(
    orgId: string,
    conversationId: string,
  ): Promise<{ summary: string; ai_interaction_id: string | null }> {
    const recent = await this.fetchRecentMessages(orgId, conversationId, 30);
    if (recent.length === 0) {
      return { summary: '', ai_interaction_id: null };
    }

    const userPrompt = this.buildSummarizePrompt(recent);

    const { data: summary, interaction_id } = await this.anthropic.complete<string>({
      interaction_type: 'summarize',
      org_id: orgId,
      system: SUMMARIZE_SYSTEM_PROMPT,
      user: userPrompt,
      max_tokens: 256,
      context: { conversation_id: conversationId },
    });

    const trimmed = summary.trim();
    if (trimmed) {
      await this.supabase.adminClient
        .from('conversations')
        .update({ ai_summary: trimmed })
        .eq('org_id', orgId)
        .eq('id', conversationId);
    }

    return { summary: trimmed, ai_interaction_id: interaction_id };
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/classification/:messageId — leitura pura
  // ──────────────────────────────────────────────────────────

  /**
   * Lê a classificação persistida da mensagem. Retorna o objeto completo
   * de `metadata.ai_classification` se existir, ou os campos básicos
   * (ai_intent / ai_sentiment) com null quando ausentes.
   */
  async getClassification(
    orgId: string,
    messageId: string,
  ): Promise<{
    message_id: string;
    ai_intent: string | null;
    ai_sentiment: string | null;
    classification: ClassificationResult | null;
  }> {
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .select('id, ai_intent, ai_sentiment, metadata')
      .eq('org_id', orgId)
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Message ${messageId} not found`);

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const classification =
      (metadata.ai_classification as ClassificationResult | undefined) ?? null;

    return {
      message_id: data.id as string,
      ai_intent: (data.ai_intent as string | null) ?? null,
      ai_sentiment: (data.ai_sentiment as string | null) ?? null,
      classification,
    };
  }

  // ──────────────────────────────────────────────────────────
  // POST /ai/fill-field — preencher campo com IA
  // ──────────────────────────────────────────────────────────

  /**
   * Gera conteúdo pra um campo de texto baseado no estado da entidade
   * (deal/contact/company/task) + últimas mensagens da conversa vinculada.
   * Retorna o texto plano gerado (sem JSON schema — output mais natural).
   */
  async fillField(args: {
    orgId: string;
    entityType: 'deal' | 'contact' | 'company' | 'task';
    entityId: string;
    fieldName: string;
    currentValue?: string;
    hint?: string;
  }): Promise<{ value: string; ai_interaction_id: string | null }> {
    const ctx = await this.buildFillContext(args);
    if (!ctx) {
      throw new NotFoundException(
        `${args.entityType} ${args.entityId} não encontrado.`,
      );
    }

    const userPrompt = this.buildFillFieldPrompt({
      ...args,
      context: ctx,
    });

    const { data: text, interaction_id } = await this.anthropic.complete<string>({
      interaction_type: 'summarize',
      org_id: args.orgId,
      system: FILL_FIELD_SYSTEM_PROMPT,
      user: userPrompt,
      max_tokens: 512,
      context: {
        ...(ctx.conversationId ? { conversation_id: ctx.conversationId } : {}),
        ...(ctx.contactId ? { contact_id: ctx.contactId } : {}),
        ...(args.entityType === 'deal' ? { deal_id: args.entityId } : {}),
      },
    });

    return { value: text.trim(), ai_interaction_id: interaction_id };
  }

  /**
   * Carrega resumo da entidade + últimas mensagens (quando há conversa
   * vinculada). Volta `null` se a entidade não existir/não pertencer à org.
   */
  private async buildFillContext(args: {
    orgId: string;
    entityType: 'deal' | 'contact' | 'company' | 'task';
    entityId: string;
  }): Promise<FillContext | null> {
    const lines: string[] = [];
    let conversationId: string | undefined;
    let contactId: string | undefined;

    if (args.entityType === 'deal') {
      const { data } = await this.supabase.adminClient
        .from('deals')
        .select(
          'title, value, currency, ai_score, ai_risk, ai_next_action, conversation_id, contact_id, custom_fields, contact:contacts(name, phone, ai_summary, temperature, tags), stage:pipeline_stages(name)',
        )
        .eq('org_id', args.orgId)
        .eq('id', args.entityId)
        .maybeSingle();
      if (!data) return null;
      const d = data as DealCtx;
      const contact = Array.isArray(d.contact) ? d.contact[0] ?? null : d.contact;
      const stage = Array.isArray(d.stage) ? d.stage[0] ?? null : d.stage;
      lines.push(`# Deal: ${d.title}`);
      if (d.value) lines.push(`- Valor: ${d.currency} ${d.value}`);
      if (stage?.name) lines.push(`- Stage: ${stage.name}`);
      if (typeof d.ai_score === 'number') lines.push(`- AI Score: ${d.ai_score}/100`);
      if (d.ai_risk) lines.push(`- Risco: ${d.ai_risk}`);
      if (d.ai_next_action) lines.push(`- Próxima ação sugerida: ${d.ai_next_action}`);
      if (contact?.name) lines.push(`- Cliente: ${contact.name}`);
      if (contact?.temperature) lines.push(`- Temperatura: ${contact.temperature}`);
      if (contact?.tags?.length) lines.push(`- Tags: ${contact.tags.join(', ')}`);
      if (contact?.ai_summary) lines.push(`- Resumo do cliente: ${contact.ai_summary}`);
      conversationId = d.conversation_id ?? undefined;
      contactId = d.contact_id ?? undefined;
    } else if (args.entityType === 'contact') {
      const { data } = await this.supabase.adminClient
        .from('contacts')
        .select('name, phone, email, temperature, score, ai_summary, tags, custom_fields')
        .eq('org_id', args.orgId)
        .eq('id', args.entityId)
        .maybeSingle();
      if (!data) return null;
      const c = data as ContactCtx;
      lines.push(`# Contato: ${c.name ?? c.phone ?? '(sem nome)'}`);
      if (c.phone) lines.push(`- Telefone: ${c.phone}`);
      if (c.email) lines.push(`- Email: ${c.email}`);
      if (c.temperature) lines.push(`- Temperatura: ${c.temperature}`);
      if (typeof c.score === 'number') lines.push(`- Score: ${c.score}/100`);
      if (c.tags?.length) lines.push(`- Tags: ${c.tags.join(', ')}`);
      if (c.ai_summary) lines.push(`- Resumo: ${c.ai_summary}`);
      contactId = args.entityId;
    } else if (args.entityType === 'company') {
      const { data } = await this.supabase.adminClient
        .from('companies')
        .select('name, domain, industry, size, custom_fields')
        .eq('org_id', args.orgId)
        .eq('id', args.entityId)
        .maybeSingle();
      if (!data) return null;
      const c = data as CompanyCtx;
      lines.push(`# Empresa: ${c.name}`);
      if (c.domain) lines.push(`- Domínio: ${c.domain}`);
      if (c.industry) lines.push(`- Setor: ${c.industry}`);
      if (c.size) lines.push(`- Porte: ${c.size}`);
    } else if (args.entityType === 'task') {
      const { data } = await this.supabase.adminClient
        .from('tasks')
        .select('title, task_type, priority, status, due_date, deal_id, contact_id')
        .eq('org_id', args.orgId)
        .eq('id', args.entityId)
        .maybeSingle();
      if (!data) return null;
      const t = data as TaskCtx;
      lines.push(`# Tarefa: ${t.title}`);
      if (t.task_type) lines.push(`- Tipo: ${t.task_type}`);
      if (t.priority) lines.push(`- Prioridade: ${t.priority}`);
      if (t.status) lines.push(`- Status: ${t.status}`);
      if (t.due_date) lines.push(`- Vencimento: ${t.due_date}`);
      contactId = t.contact_id ?? undefined;
    }

    // Últimas 8 mensagens, se houver conversa vinculada
    let messageLines = '';
    if (conversationId) {
      const recent = await this.fetchRecentMessages(args.orgId, conversationId, 8);
      messageLines = recent
        .map((m, i) => `${i + 1}. ${formatMessageLine(m)}`)
        .join('\n');
    }

    return {
      summary: lines.join('\n'),
      messageLines,
      conversationId,
      contactId,
    };
  }

  private buildFillFieldPrompt(args: {
    entityType: 'deal' | 'contact' | 'company' | 'task';
    fieldName: string;
    currentValue?: string;
    hint?: string;
    context: FillContext;
  }): string {
    const lines: string[] = [];
    lines.push(args.context.summary);

    if (args.context.messageLines) {
      lines.push('');
      lines.push('# Conversa recente (mais antigas → mais novas)');
      lines.push(args.context.messageLines);
    }

    lines.push('');
    lines.push(`# Campo a preencher`);
    lines.push(`- Nome: ${args.fieldName}`);
    lines.push(`- Tipo de entidade: ${args.entityType}`);
    if (args.currentValue) {
      lines.push(`- Valor atual (ajuste/melhore se útil): ${args.currentValue}`);
    }
    if (args.hint) {
      lines.push(`- Hint: ${args.hint}`);
    }
    return lines.join('\n');
  }

  // ──────────────────────────────────────────────────────────
  // PATCH /ai/interactions/:id/feedback — feedback do usuário (👍/👎)
  // ──────────────────────────────────────────────────────────

  /**
   * Salva feedback positivo/negativo do usuário em
   * `ai_interactions.metadata.feedback`. Usado pra refinar prompts e
   * detectar regressões de qualidade ao longo do tempo.
   */
  async submitInteractionFeedback(
    orgId: string,
    interactionId: string,
    feedback: 'positive' | 'negative',
    comment: string | null,
  ): Promise<void> {
    // 1. Busca metadata atual pra fazer merge não-destrutivo
    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .select('metadata')
      .eq('org_id', orgId)
      .eq('id', interactionId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Interaction ${interactionId} not found`);

    const metadata = (data.metadata as Record<string, unknown> | null) ?? {};
    const feedbackAt = new Date().toISOString();
    const next = {
      ...metadata,
      feedback,
      feedback_comment: comment ?? null,
      feedback_at: feedbackAt,
    };

    // Escreve nas COLUNAS explícitas (migration 019) + jsonb (compat).
    // Colunas indexadas permitem agregações rápidas no relatório.
    const { error: updErr } = await this.supabase.adminClient
      .from('ai_interactions')
      .update({
        metadata: next,
        feedback,
        feedback_comment: comment ?? null,
        feedback_at: feedbackAt,
      })
      .eq('org_id', orgId)
      .eq('id', interactionId);

    if (updErr) throw new InternalServerErrorException(updErr.message);
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/feedback/stats — métricas de feedback pra Relatórios
  // ──────────────────────────────────────────────────────────

  /**
   * Agrega feedback por org num período (default 30 dias):
   *   - total positivos / negativos
   *   - taxa de aprovação (% positivos sobre total feedback dado)
   *   - top 5 comentários negativos mais recentes
   *   - série semanal de aprovação (line chart)
   */
  async getFeedbackStats(
    orgId: string,
    periodDays = 30,
  ): Promise<{
    total_positive: number;
    total_negative: number;
    approval_rate: number;
    recent_negative_comments: Array<{ comment: string; at: string }>;
    weekly: Array<{ week_start: string; positive: number; negative: number; approval_rate: number }>;
  }> {
    const sinceIso = new Date(Date.now() - periodDays * 86_400_000).toISOString();

    const { data, error } = await this.supabase.adminClient
      .from('ai_interactions')
      .select('feedback, feedback_comment, feedback_at')
      .eq('org_id', orgId)
      .not('feedback', 'is', null)
      .gte('feedback_at', sinceIso)
      .order('feedback_at', { ascending: false });

    if (error) throw new InternalServerErrorException(error.message);

    const rows = ((data ?? []) as Array<{
      feedback: 'positive' | 'negative';
      feedback_comment: string | null;
      feedback_at: string;
    }>);

    const total_positive = rows.filter((r) => r.feedback === 'positive').length;
    const total_negative = rows.filter((r) => r.feedback === 'negative').length;
    const total = total_positive + total_negative;
    const approval_rate = total > 0 ? Math.round((total_positive / total) * 100) : 0;

    const recent_negative_comments = rows
      .filter((r) => r.feedback === 'negative' && r.feedback_comment && r.feedback_comment.trim())
      .slice(0, 5)
      .map((r) => ({ comment: r.feedback_comment!, at: r.feedback_at }));

    // Buckets semanais (UTC week start)
    const weekMap = new Map<string, { positive: number; negative: number }>();
    for (const r of rows) {
      const d = new Date(r.feedback_at);
      const dayOfWeek = d.getUTCDay(); // 0=domingo
      const monday = new Date(d);
      monday.setUTCDate(d.getUTCDate() - ((dayOfWeek + 6) % 7));
      monday.setUTCHours(0, 0, 0, 0);
      const key = monday.toISOString().slice(0, 10);
      const bucket = weekMap.get(key) ?? { positive: 0, negative: 0 };
      if (r.feedback === 'positive') bucket.positive += 1;
      else bucket.negative += 1;
      weekMap.set(key, bucket);
    }
    const weekly = Array.from(weekMap.entries())
      .map(([week_start, b]) => {
        const t = b.positive + b.negative;
        return {
          week_start,
          positive: b.positive,
          negative: b.negative,
          approval_rate: t > 0 ? Math.round((b.positive / t) * 100) : 0,
        };
      })
      .sort((a, b) => a.week_start.localeCompare(b.week_start));

    return { total_positive, total_negative, approval_rate, recent_negative_comments, weekly };
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/gaps/:conversationId — detecta gaps via IA (Haiku)
  // ──────────────────────────────────────────────────────────

  /**
   * Cache em memória de gaps por conversa (TTL 5 min).
   * Map<orgId::conversationId, { result, expiresAt }>.
   */
  private readonly gapsCache = new Map<
    string,
    { result: GapsResult; expiresAt: number }
  >();

  /**
   * Analisa as últimas 20 mensagens da conversa via Haiku e identifica:
   *   - Perguntas do cliente sem resposta adequada
   *   - Dados do perfil do contato faltando (email, empresa, etc.)
   *   - Ações sugeridas para o vendedor
   *
   * Cache de 5 min por conversa pra evitar custo de IA a cada toque.
   */
  async detectGaps(orgId: string, conversationId: string): Promise<GapsResult> {
    const cacheKey = `${orgId}::${conversationId}`;
    const cached = this.gapsCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }

    const conv = await this.fetchConversationCore(orgId, conversationId);
    const recent = await this.fetchRecentMessages(orgId, conversationId, 20);

    // Perfil do contato (pra saber quais campos já estão preenchidos)
    let contactProfile = '';
    if (conv.contact_id) {
      const { data: c } = await this.supabase.adminClient
        .from('contacts')
        .select('name, email, phone, company_id, tags')
        .eq('org_id', orgId)
        .eq('id', conv.contact_id)
        .maybeSingle();
      if (c) {
        const fields: string[] = [];
        const row = c as { name: string | null; email: string | null; phone: string | null; company_id: string | null; tags: string[] | null };
        fields.push(`- name: ${row.name ?? '(faltando)'}`);
        fields.push(`- email: ${row.email ?? '(faltando)'}`);
        fields.push(`- phone: ${row.phone ?? '(faltando)'}`);
        fields.push(`- company: ${row.company_id ? 'vinculada' : '(faltando)'}`);
        fields.push(`- tags: ${(row.tags && row.tags.length > 0) ? row.tags.join(', ') : '(faltando)'}`);
        contactProfile = fields.join('\n');
      }
    }

    const userPrompt = [
      'Conversa recente (cronológica, mais antiga → mais nova). O index é a posição na lista (0-based):',
      recent.map((m, i) => `[${i}] ${formatMessageLine(m)}`).join('\n') || '(sem mensagens)',
      '',
      'Perfil do contato:',
      contactProfile || '(sem dados de contato)',
    ].join('\n');

    let result: GapsResult;
    try {
      const { data } = await this.anthropic.complete<GapsResult>({
        interaction_type: 'diagnose',
        org_id: orgId,
        system: GAPS_SYSTEM_PROMPT,
        user: userPrompt,
        schema: GAPS_SCHEMA,
        max_tokens: 768,
        // Análise de gaps é mecânica → Haiku. O 'diagnose' do analyzeFunnel
        // (raciocínio) fica sem tier e mantém Sonnet.
        tier: 'cheap',
        context: { conversation_id: conversationId },
      });
      result = {
        unanswered_questions: Array.isArray(data?.unanswered_questions) ? data.unanswered_questions : [],
        missing_profile_data: Array.isArray(data?.missing_profile_data) ? data.missing_profile_data : [],
        suggested_actions: Array.isArray(data?.suggested_actions) ? data.suggested_actions : [],
      };
    } catch (err) {
      this.logger.warn(
        `detectGaps failed (returning empty): ${err instanceof Error ? err.message : String(err)}`,
      );
      result = { unanswered_questions: [], missing_profile_data: [], suggested_actions: [] };
    }

    this.gapsCache.set(cacheKey, { result, expiresAt: Date.now() + 5 * 60_000 });
    return result;
  }

  /** Invalida cache de gaps — chamado quando uma nova mensagem entra. */
  invalidateGapsCache(orgId: string, conversationId: string): void {
    this.gapsCache.delete(`${orgId}::${conversationId}`);
  }

  // ──────────────────────────────────────────────────────────
  // Scheduling intent detection (Bloco Agendamentos)
  // ──────────────────────────────────────────────────────────

  /**
   * Analisa a última mensagem inbound + contexto e decide se o cliente
   * quer agendar algo. Retorna detalhes pra o orchestrator decidir
   * quais slots oferecer.
   *
   * Best-effort: erro retorna `wants_scheduling=false` (não bloqueia o
   * pipeline normal de suggestResponse).
   */
  async detectSchedulingIntent(
    orgId: string,
    conversationId: string,
    messageText: string,
  ): Promise<SchedulingIntentResult> {
    const recent = await this.fetchRecentMessages(orgId, conversationId, 6);
    const today = new Date().toISOString().slice(0, 10);
    const userPrompt = [
      `HOJE é ${today} (use como referência pra "amanhã", "depois de amanhã", dias da semana).`,
      '',
      'Conversa recente (cronológica):',
      recent.map((m, i) => `${i + 1}. ${formatMessageLine(m)}`).join('\n') || '(sem mensagens anteriores)',
      '',
      `Mensagem ATUAL do cliente a analisar: "${messageText}"`,
    ].join('\n');

    try {
      const { data } = await this.anthropic.complete<SchedulingIntentResult>({
        interaction_type: 'classify_intent',
        org_id: orgId,
        system: SCHEDULING_INTENT_SYSTEM_PROMPT,
        user: userPrompt,
        schema: SCHEDULING_INTENT_SCHEMA,
        max_tokens: 256,
        context: { conversation_id: conversationId },
      });
      return {
        wants_scheduling: !!data.wants_scheduling,
        appointment_type_guess: data.appointment_type_guess ?? null,
        preferred_date: data.preferred_date ?? null,
        preferred_time: data.preferred_time ?? null,
        urgency: ['low', 'medium', 'high'].includes(data.urgency) ? data.urgency : 'medium',
        extracted_text: data.extracted_text ?? messageText,
      };
    } catch (err) {
      this.logger.warn(
        `detectSchedulingIntent failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return {
        wants_scheduling: false,
        appointment_type_guess: null,
        preferred_date: null,
        preferred_time: null,
        urgency: 'low',
        extracted_text: messageText,
      };
    }
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/unanswered/:conversationId — perguntas inbound sem resposta
  // ──────────────────────────────────────────────────────────

  /**
   * Detecta mensagens inbound da conversa que potencialmente são perguntas
   * sem resposta — sem custo de IA. Heurística simples:
   *   1. Pega últimas 30 mensagens em ordem cronológica
   *   2. Pega TODAS as inbound após a última outbound do agente
   *   3. Marca as que parecem pergunta (terminam em ?, ou têm marcadores)
   *
   * Retorna até 5 itens recentes pra UI exibir como "perguntas pendentes".
   */
  async getUnansweredQuestions(
    orgId: string,
    conversationId: string,
  ): Promise<
    Array<{
      message_id: string;
      created_at: string;
      text: string;
      is_question: boolean;
    }>
  > {
    const recent = await this.fetchRecentMessages(orgId, conversationId, 30);

    // Encontra a última outbound (de agente humano OU bot — ambos são "respostas").
    let lastOutboundIdx = -1;
    for (let i = recent.length - 1; i >= 0; i--) {
      if (recent[i]?.direction === 'outbound') {
        lastOutboundIdx = i;
        break;
      }
    }

    // Pega inbound APÓS a última outbound — esses são "não respondidos"
    const candidates = recent.slice(lastOutboundIdx + 1).filter((m) => m.direction === 'inbound');

    // Limita a 5 mais recentes pra não poluir a UI
    const top = candidates.slice(-5);

    return top.map((m) => {
      const text = (m.plain_text ?? extractInlineText(m) ?? '').trim();
      return {
        message_id: m.id,
        created_at: m.created_at,
        text: text.length > 240 ? `${text.slice(0, 240)}…` : text,
        is_question: looksLikeQuestion(text),
      };
    });
  }

  // ──────────────────────────────────────────────────────────
  // Orquestração: processInbound (chamado fire-and-forget pelo webhook)
  // ──────────────────────────────────────────────────────────

  /**
   * Cache curto (60s) do flag passive_enabled por org — evita um SELECT
   * redundante em organizations.settings a cada mensagem inbound.
   */
  private readonly passiveFlagCache = new Map<
    string,
    { enabled: boolean; expiresAt: number }
  >();
  private static readonly PASSIVE_FLAG_TTL_MS = 60_000;

  /**
   * Lê organizations.settings.ai_features.passive_enabled. Default = true
   * (comportamento atual): só retorna false quando a org setou EXPLICITAMENTE
   * `false`. Falha graciosa → true (nunca desliga IA por erro de leitura).
   */
  private async isPassiveAiEnabled(orgId: string): Promise<boolean> {
    const cached = this.passiveFlagCache.get(orgId);
    if (cached && cached.expiresAt > Date.now()) return cached.enabled;

    let enabled = true;
    try {
      const { data } = await this.supabase.adminClient
        .from('organizations')
        .select('settings')
        .eq('id', orgId)
        .maybeSingle();
      const settings = (data?.settings as Record<string, unknown> | null) ?? {};
      const aiFeatures = (settings.ai_features as
        | { passive_enabled?: unknown }
        | undefined) ?? {};
      // Só desliga quando explicitamente === false.
      enabled = aiFeatures.passive_enabled !== false;
    } catch (err) {
      this.logger.warn(
        `isPassiveAiEnabled falhou (default=true): ${err instanceof Error ? err.message : String(err)}`,
      );
      enabled = true;
    }

    this.passiveFlagCache.set(orgId, {
      enabled,
      expiresAt: Date.now() + AiService.PASSIVE_FLAG_TTL_MS,
    });
    return enabled;
  }

  /**
   * Roda classify + suggest em paralelo após a chegada de uma mensagem
   * inbound. Após sucesso, emite `ai:suggestion` via WebSocket pra o
   * frontend exibir a barra de sugestão.
   *
   * Usar com `void` (sem await) no caller pra não bloquear o response.
   */
  async processInbound(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    try {
      // Gate passivo por org: classify + suggest rodam em TODA mensagem inbound
      // e geram custo mesmo sem atendente olhando. Uma org pode desligar via
      // organizations.settings.ai_features.passive_enabled = false. Default =
      // habilitado (comportamento atual) — só desliga quando explicitamente
      // false. NÃO afeta concierge (tem o próprio enabled) nem scheduling/
      // data-collection.
      const passiveEnabled = await this.isPassiveAiEnabled(orgId);

      const [classification, suggestion] = passiveEnabled
        ? await Promise.all([
            this.classifyMessage(orgId, conversationId, messageId).catch((err) => {
              this.logger.warn(
                `classify failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            }),
            this.suggestResponse(orgId, conversationId).catch((err) => {
              this.logger.warn(
                `suggest failed: ${err instanceof Error ? err.message : String(err)}`,
              );
              return null;
            }),
          ])
        : ([null, null] as const);

      if (!passiveEnabled) {
        this.logger.debug(
          `processInbound: passive AI desligado pra org=${orgId} — pulando classify+suggest`,
        );
      }

      if (suggestion) {
        this.events.emitToOrg(orgId, 'ai:suggestion', {
          conversation_id: conversationId,
          suggestion: suggestion.suggested_response,
          confidence: suggestion.confidence,
          ...(suggestion.ai_interaction_id
            ? { ai_interaction_id: suggestion.ai_interaction_id }
            : {}),
          ...(suggestion.live_sources_used.length > 0
            ? { live_sources_used: suggestion.live_sources_used }
            : {}),
        });
      }

      // Trigger summary periodicamente (a cada 5 mensagens). Best-effort.
      const conv = await this.fetchConversationCore(orgId, conversationId).catch(() => null);
      if (conv && conv.message_count > 0 && conv.message_count % 5 === 0) {
        void this.summarizeConversation(orgId, conversationId).catch(() => {});
      }

      // Invalida cache de gaps — a próxima leitura recalcula incluindo a
      // nova mensagem (mantém atualizado sem custo a cada turn).
      this.invalidateGapsCache(orgId, conversationId);

      // Bloco Agendamentos — detecta intenção de agendar e emite slots
      void this.tryDetectSchedulingIntent(orgId, conversationId, messageId).catch((err) => {
        this.logger.warn(
          `scheduling intent detect failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // Bloco G PARTE 1 — coleta proativa de dados:
      // Se há deal vinculado e o stage tem required_fields, tenta extrair
      // dados da última mensagem inbound. Best-effort.
      void this.tryExtractRequiredFields(orgId, conversationId, messageId).catch((err) => {
        this.logger.warn(
          `data-collection extract failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // AI Concierge — primeira camada de inteligência conversacional.
      // Decide se manda saudação automática (1ª msg) ou roteia o lead pra
      // pipeline+stage certo (2ª msg). Roda só quando ai_concierge.enabled
      // está ligado nos settings da org.
      void this.concierge.handle(orgId, conversationId, messageId).catch((err) => {
        this.logger.warn(
          `concierge handle failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      this.logger.debug(
        `processInbound done conv=${conversationId} classified=${!!classification} suggested=${!!suggestion}`,
      );
    } catch (err) {
      this.logger.error(
        `processInbound failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Heurística leve: regex de keywords pra evitar custo de Haiku quando
   * a mensagem claramente não tem nada a ver com agendamento.
   */
  private readonly SCHEDULING_KEYWORDS_RE =
    /\b(agend(ar|amento)|marcar|hor[áa]rio|disponibilidade|quando posso|tem agenda|reuni[ãa]o|visita|consulta|encontrar|ligar|call|videoconfer[êe]ncia)\b/i;

  /**
   * Detecta intenção de agendamento na última mensagem inbound. Se positiva,
   * busca slots disponíveis (próximos 3 dias úteis ou data preferida) e
   * emite `ai:scheduling-suggestion` via WebSocket pra UI mostrar botões
   * clicáveis na barra de sugestão.
   *
   * Best-effort: erros são logados mas não bloqueiam o pipeline.
   */
  private async tryDetectSchedulingIntent(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // 1. Pega texto da mensagem inbound
    const { data: msg } = await this.supabase.adminClient
      .from('messages')
      .select('plain_text, direction')
      .eq('org_id', orgId)
      .eq('id', messageId)
      .maybeSingle();
    const m = msg as { plain_text: string | null; direction: string } | null;
    if (!m || m.direction !== 'inbound' || !m.plain_text) return;

    // 2. Filtro de keyword cheap pra evitar Haiku desnecessário
    if (!this.SCHEDULING_KEYWORDS_RE.test(m.plain_text)) return;

    // 3. Roda Haiku
    const intent = await this.detectSchedulingIntent(orgId, conversationId, m.plain_text);
    if (!intent.wants_scheduling) return;

    // 4. Resolve data preferida (ou amanhã se não especificada)
    const targetDate = intent.preferred_date ?? this.nextBusinessDay();

    // 5. Busca slots — emite evento mesmo se vazios pra UI mostrar fallback
    try {
      const slots = await this.appointmentsLookup.getAvailableSlots(orgId, {
        date: targetDate,
      });
      const top = slots.slice(0, 6); // top 6 pra não poluir UI
      this.events.emitToOrg(orgId, 'ai:scheduling-suggestion', {
        conversation_id: conversationId,
        slots: top.map((s) => ({
          start_time: s.start_time,
          end_time: s.end_time,
          agent_id: s.agent_id,
          agent_name: s.agent_name,
        })),
        appointment_type_guess: intent.appointment_type_guess,
      });
    } catch (err) {
      this.logger.warn(
        `getAvailableSlots failed (scheduling intent): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /** Próximo dia útil (segunda a sexta) em formato YYYY-MM-DD. */
  private nextBusinessDay(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Tenta extrair dados (email, telefone, valor, etc.) da última mensagem
   * inbound quando o deal está num stage que tem required_fields. Atualiza
   * contact/deal automaticamente sem pedir nada — se a info já veio de
   * graça, não custa nada salvar.
   */
  private async tryExtractRequiredFields(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    // Busca deal vinculado (se houver)
    const { data: dealData } = await this.supabase.adminClient
      .from('deals')
      .select('id')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    const dealId = (dealData as { id: string } | null)?.id;
    if (!dealId) return;

    const detected = await this.dataCollection.detectMissingFields(orgId, dealId);
    if (!detected || detected.missing.length === 0) return;

    // Pega texto da mensagem
    const { data: msg } = await this.supabase.adminClient
      .from('messages')
      .select('plain_text, direction')
      .eq('org_id', orgId)
      .eq('id', messageId)
      .maybeSingle();
    const messageRow = msg as { plain_text: string | null; direction: string } | null;
    if (!messageRow || messageRow.direction !== 'inbound' || !messageRow.plain_text) return;

    const extracted = await this.dataCollection.processResponseForFields(
      orgId,
      messageRow.plain_text,
      detected,
    );
    if (!extracted.contact && !extracted.deal) return;

    const result = await this.dataCollection.applyExtractedFields(orgId, detected, extracted);
    if (result.updated_contact.length > 0 || result.updated_deal.length > 0) {
      this.logger.log(
        `data-collection: contact=${result.updated_contact.join(',') || '-'} deal=${result.updated_deal.join(',') || '-'}`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  // DEAL SCORING & FUNNEL ANALYSIS
  // ══════════════════════════════════════════════════════════

  // ──────────────────────────────────────────────────────────
  // d) scoreDeal — pontua um deal e atualiza ai_score / lead_scores
  // ──────────────────────────────────────────────────────────

  async scoreDeal(orgId: string, dealId: string): Promise<DealScoreResult> {
    const deal = await this.fetchDeal(orgId, dealId);

    // Conversa vinculada (se houver) → últimas 20 mensagens
    const messages = deal.conversation_id
      ? await this.fetchRecentMessages(orgId, deal.conversation_id, 20)
      : [];

    // Atividades recentes do deal
    const activities = await this.fetchDealActivities(orgId, dealId, 10);

    // Tempo no stage atual
    const hoursInStage = this.hoursSince(deal.stage_entered_at);

    // Contato (perfil)
    const contact = deal.contact_id
      ? await this.fetchContactSummary(orgId, deal.contact_id)
      : null;

    const userPrompt = this.buildScoreDealPrompt(
      deal,
      contact,
      messages,
      activities,
      hoursInStage,
    );

    const { data: scoring } = await this.anthropic.complete<DealScoreResult>({
      interaction_type: 'lead_score',
      org_id: orgId,
      system: DEAL_SCORE_SYSTEM_PROMPT,
      user: userPrompt,
      schema: DEAL_SCORE_SCHEMA,
      max_tokens: 1024,
      context: {
        conversation_id: deal.conversation_id ?? undefined,
        contact_id: deal.contact_id ?? undefined,
        deal_id: dealId,
      },
    });

    // Clamp valores (schema não tem minimum/maximum)
    const score = clamp(Math.round(Number(scoring.score) || 0), 0, 100);
    const closeProb = clamp(Math.round(Number(scoring.close_probability) || 0), 0, 100);
    const factors: DealScoreResult['factors'] = {
      engagement: clamp(Math.round(Number(scoring.factors?.engagement) || 0), 0, 25),
      recency: clamp(Math.round(Number(scoring.factors?.recency) || 0), 0, 25),
      fit: clamp(Math.round(Number(scoring.factors?.fit) || 0), 0, 25),
      intent: clamp(Math.round(Number(scoring.factors?.intent) || 0), 0, 25),
      details: Array.isArray(scoring.factors?.details) ? scoring.factors.details : [],
    };
    const nextAction = (scoring.next_action ?? '').slice(0, 200);

    const finalResult: DealScoreResult = {
      score,
      risk: scoring.risk,
      close_probability: closeProb,
      next_action: nextAction,
      factors,
    };

    await this.persistDealScore(orgId, deal, finalResult);

    return finalResult;
  }

  // ──────────────────────────────────────────────────────────
  // e) analyzeFunnel — métricas determinísticas + insights da IA
  // ──────────────────────────────────────────────────────────

  async analyzeFunnel(orgId: string, pipelineId: string): Promise<FunnelAnalysisResult> {
    const pipeline = await this.fetchPipeline(orgId, pipelineId);

    // Stages + active deals via view + closed deals dos últimos 30 dias
    const [stages, activeDeals, closedDeals] = await Promise.all([
      this.fetchPipelineStages(pipelineId),
      this.fetchActiveBoardDeals(orgId, pipelineId),
      this.fetchClosedDealsSince(orgId, pipelineId, 30),
    ]);

    // Métricas determinísticas
    const totalValue = round2(activeDeals.reduce((sum, d) => sum + Number(d.value || 0), 0));
    const weightedValue = round2(
      activeDeals.reduce(
        (sum, d) => sum + (Number(d.value || 0) * Number(d.stage_probability || 0)) / 100,
        0,
      ),
    );

    const wonRecent = closedDeals.filter((d) => d.won_at !== null);
    const lostRecent = closedDeals.filter((d) => d.lost_at !== null);
    const totalClosed = wonRecent.length + lostRecent.length;
    const conversionRate = totalClosed > 0 ? wonRecent.length / totalClosed : 0;

    const cycleDaysWon = wonRecent
      .map((d) =>
        d.won_at && d.created_at
          ? (new Date(d.won_at).getTime() - new Date(d.created_at).getTime()) / 86_400_000
          : null,
      )
      .filter((n): n is number => n !== null && Number.isFinite(n));
    const avgCycleDays =
      cycleDaysWon.length > 0
        ? round2(cycleDaysWon.reduce((s, n) => s + n, 0) / cycleDaysWon.length)
        : 0;

    // Snapshot do board pra prompt do modelo
    const userPrompt = this.buildFunnelPrompt({
      pipelineName: pipeline.name,
      stages,
      activeDeals,
      closedRecent: { won: wonRecent.length, lost: lostRecent.length },
      metrics: { totalValue, weightedValue, avgCycleDays, conversionRate },
    });

    const { data: aiResult } = await this.anthropic.complete<FunnelAnalysisResult>({
      interaction_type: 'diagnose',
      org_id: orgId,
      system: FUNNEL_ANALYSIS_SYSTEM_PROMPT,
      user: userPrompt,
      schema: FUNNEL_ANALYSIS_SCHEMA,
      max_tokens: 1500,
    });

    // Sobrescreve métricas determinísticas (modelo pode errar somas)
    const finalResult: FunnelAnalysisResult = {
      total_pipeline_value: totalValue,
      weighted_value: weightedValue,
      avg_cycle_days: avgCycleDays,
      conversion_rate: round2(conversionRate),
      bottleneck_stage: aiResult.bottleneck_stage ?? null,
      bottleneck_reason: aiResult.bottleneck_reason ?? null,
      insights: Array.isArray(aiResult.insights) ? aiResult.insights : [],
      recommendations: Array.isArray(aiResult.recommendations) ? aiResult.recommendations : [],
    };

    await this.persistFunnelAnalysis(orgId, pipeline.id, finalResult);
    return finalResult;
  }

  // ──────────────────────────────────────────────────────────
  // f) scoreAllDeals — batch com concurrency limit
  // ──────────────────────────────────────────────────────────

  /**
   * Reavalia score de todos os deals ativos da org (opcionalmente filtrado
   * por pipeline). Usa workers pool com 3 chamadas concorrentes — não
   * estoura rate limit do Anthropic e não fica refém do deal mais lento.
   */
  async scoreAllDeals(
    orgId: string,
    pipelineId?: string,
  ): Promise<{ scored: number; failed: number; total: number }> {
    let q = this.supabase.adminClient
      .from('deals')
      .select('id')
      .eq('org_id', orgId)
      .is('won_at', null)
      .is('lost_at', null);
    if (pipelineId) q = q.eq('pipeline_id', pipelineId);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);

    const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
    if (ids.length === 0) return { scored: 0, failed: 0, total: 0 };

    let scored = 0;
    let failed = 0;
    let cursor = 0;
    const concurrency = 3;

    const worker = async (): Promise<void> => {
      while (cursor < ids.length) {
        const i = cursor++;
        const dealId = ids[i]!;
        try {
          await this.scoreDeal(orgId, dealId);
          scored++;
        } catch (err) {
          failed++;
          this.logger.warn(
            `scoreDeal(${dealId}) failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    };

    await Promise.all(Array.from({ length: concurrency }, () => worker()));
    return { scored, failed, total: ids.length };
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/funnel-insights/:pipelineId — leitura do cache
  // ──────────────────────────────────────────────────────────

  async getCachedFunnelAnalysis(
    orgId: string,
    pipelineId: string,
  ): Promise<{
    pipeline_id: string;
    analysis: FunnelAnalysisResult | null;
    generated_at: string | null;
  }> {
    const pipeline = await this.fetchPipeline(orgId, pipelineId);
    const settings = (pipeline.settings ?? {}) as Record<string, unknown>;
    const cached = settings.ai_funnel_analysis as
      | (FunnelAnalysisResult & { generated_at: string })
      | undefined;

    if (!cached) {
      return { pipeline_id: pipeline.id, analysis: null, generated_at: null };
    }

    const { generated_at, ...analysis } = cached;
    return { pipeline_id: pipeline.id, analysis, generated_at };
  }

  // ──────────────────────────────────────────────────────────
  // Persistência: deal score + lead_scores
  // ──────────────────────────────────────────────────────────

  private async persistDealScore(
    orgId: string,
    deal: Deal,
    result: DealScoreResult,
  ): Promise<void> {
    // Atualiza deal
    await this.supabase.adminClient
      .from('deals')
      .update({
        ai_score: result.score,
        ai_risk: result.risk,
        ai_close_probability: result.close_probability,
        ai_next_action: result.next_action,
      })
      .eq('org_id', orgId)
      .eq('id', deal.id);

    // Upsert em lead_scores se houver contact_id
    if (deal.contact_id) {
      // Pega score anterior pra preencher previous_score
      const { data: prev } = await this.supabase.adminClient
        .from('lead_scores')
        .select('score')
        .eq('org_id', orgId)
        .eq('contact_id', deal.contact_id)
        .maybeSingle();

      await this.supabase.adminClient.from('lead_scores').upsert(
        {
          org_id: orgId,
          contact_id: deal.contact_id,
          score: result.score,
          factors: result.factors as unknown as Json,
          previous_score: (prev?.score as number | null | undefined) ?? null,
          calculated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,contact_id' },
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // Persistência: cache de funnel analysis em pipelines.settings
  // ──────────────────────────────────────────────────────────

  private async persistFunnelAnalysis(
    orgId: string,
    pipelineId: string,
    result: FunnelAnalysisResult,
  ): Promise<void> {
    // Read-modify-write em settings (jsonb merge não é atômico — janela mínima)
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('settings')
      .eq('org_id', orgId)
      .eq('id', pipelineId)
      .maybeSingle();

    if (error || !data) {
      this.logger.warn(`persistFunnelAnalysis lookup failed: ${error?.message}`);
      return;
    }

    const settings = (data.settings as Record<string, unknown> | null) ?? {};
    const next = {
      ...settings,
      ai_funnel_analysis: {
        ...result,
        generated_at: new Date().toISOString(),
      },
    };

    const { error: updErr } = await this.supabase.adminClient
      .from('pipelines')
      .update({ settings: next })
      .eq('org_id', orgId)
      .eq('id', pipelineId);

    if (updErr) {
      this.logger.warn(`persistFunnelAnalysis update failed: ${updErr.message}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Persistência da classificação
  // ──────────────────────────────────────────────────────────

  private async persistClassification(
    orgId: string,
    message: Message,
    conversation: ConversationCore,
    c: ClassificationResult,
  ): Promise<void> {
    // 1. Atualiza messages — partition pruning via created_at
    const newMetadata = {
      ...((message.metadata as Record<string, unknown>) ?? {}),
      ai_classification: c,
    } as unknown as Json;

    await this.supabase.adminClient
      .from('messages')
      .update({
        ai_intent: c.intent,
        ai_sentiment: c.sentiment,
        metadata: newMetadata,
      })
      .eq('org_id', orgId)
      .eq('id', message.id)
      .eq('created_at', message.created_at);

    // 2. Atualiza conversation
    await this.supabase.adminClient
      .from('conversations')
      .update({
        ai_intent: c.intent,
        ai_sentiment: c.sentiment,
        ai_temperature: c.temperature,
      })
      .eq('org_id', orgId)
      .eq('id', conversation.id);

    // 3. Atualiza contact temperature SE diferente
    if (conversation.contact_id) {
      const { data: contact } = await this.supabase.adminClient
        .from('contacts')
        .select('temperature')
        .eq('org_id', orgId)
        .eq('id', conversation.contact_id)
        .maybeSingle();

      if (contact && contact.temperature !== c.temperature) {
        await this.supabase.adminClient
          .from('contacts')
          .update({ temperature: c.temperature })
          .eq('org_id', orgId)
          .eq('id', conversation.contact_id);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Fetchers
  // ──────────────────────────────────────────────────────────

  private async fetchMessage(orgId: string, messageId: string): Promise<Message> {
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', messageId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Message ${messageId} not found`);
    return data as Message;
  }

  private async fetchConversationCore(
    orgId: string,
    conversationId: string,
  ): Promise<ConversationCore> {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, channel_type, message_count')
      .eq('org_id', orgId)
      .eq('id', conversationId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Conversation ${conversationId} not found`);
    return {
      id: data.id as string,
      contact_id: (data.contact_id as string | null) ?? null,
      channel_type: data.channel_type as string,
      message_count: (data.message_count as number) ?? 0,
    };
  }

  private async fetchContactSummary(
    orgId: string,
    contactId: string,
  ): Promise<ContactSummary | null> {
    const { data } = await this.supabase.adminClient
      .from('contacts')
      .select('id, name, phone, email, temperature, score, tags, ai_summary')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();
    if (!data) return null;
    return {
      name: (data.name as string | null) ?? null,
      phone: (data.phone as string | null) ?? null,
      temperature: (data.temperature as string | null) ?? null,
      score: (data.score as number | null) ?? null,
      tags: ((data.tags as string[] | null) ?? []) as string[],
      ai_summary: (data.ai_summary as string | null) ?? null,
    };
  }

  private async fetchRecentMessages(
    orgId: string,
    conversationId: string,
    limit: number,
  ): Promise<Message[]> {
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .select('*')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new InternalServerErrorException(error.message);
    // Reverse pra ter cronológico (oldest → newest) no prompt
    return ((data ?? []) as Message[]).reverse();
  }

  // ──────────────────────────────────────────────────────────
  // Prompt builders
  // ──────────────────────────────────────────────────────────

  private buildClassifyPrompt(message: Message, recent: Message[]): string {
    const target = formatMessageLine(message);
    const context = recent.map((m, i) => `${i + 1}. ${formatMessageLine(m)}`).join('\n');
    return [
      'Mensagem atual a classificar:',
      target,
      '',
      'Contexto da conversa (mensagens recentes, em ordem cronológica):',
      context || '(sem mensagens anteriores)',
    ].join('\n');
  }

  private buildSuggestPrompt(
    contact: ContactSummary | null,
    recent: Message[],
    knowledgeHits: Array<{ title: string; category: string; content: string }> = [],
    liveContent: string | null = null,
    productBlock = '',
  ): string {
    const lines: string[] = [];
    if (productBlock) {
      lines.push(productBlock);
      lines.push('');
    }
    if (contact) {
      lines.push('Perfil do contato:');
      if (contact.name) lines.push(`- Nome: ${contact.name}`);
      if (contact.phone) lines.push(`- Telefone: ${contact.phone}`);
      if (contact.temperature) lines.push(`- Temperatura: ${contact.temperature}`);
      if (contact.score !== null) lines.push(`- Score: ${contact.score}/100`);
      if (contact.tags.length > 0) lines.push(`- Tags: ${contact.tags.join(', ')}`);
      if (contact.ai_summary) lines.push(`- Resumo: ${contact.ai_summary}`);
      lines.push('');
    }

    if (knowledgeHits.length > 0) {
      lines.push('Contexto da base de conhecimento (use SOMENTE essas informações como verdade):');
      knowledgeHits.forEach((h, i) => {
        const snippet = h.content.length > 600 ? `${h.content.slice(0, 600)}…` : h.content;
        lines.push(`[${i + 1}] ${h.title} (${h.category}):`);
        lines.push(snippet);
        lines.push('');
      });
    }

    if (liveContent) {
      lines.push(
        'DADOS ATUALIZADOS DE FONTES EXTERNAS (consultados agora — informação fresca, prefira essa quando houver conflito com a base local). IMPORTANTE: quando houver URLs no formato [texto](url) ou após " → ", INCLUA-AS DIRETO na resposta ao cliente (não prometa enviar "em poucos segundos" — você JÁ tem os links agora):',
      );
      lines.push(liveContent.length > 4000 ? `${liveContent.slice(0, 4000)}…` : liveContent);
      lines.push('');
    }

    lines.push('Conversa recente (cronológica):');
    if (recent.length === 0) {
      lines.push('(sem mensagens)');
    } else {
      recent.forEach((m, i) => lines.push(`${i + 1}. ${formatMessageLine(m)}`));
    }
    return lines.join('\n');
  }

  private buildSummarizePrompt(recent: Message[]): string {
    return [
      'Conversa (cronológica):',
      ...recent.map((m, i) => `${i + 1}. ${formatMessageLine(m)}`),
    ].join('\n');
  }

  // ──────────────────────────────────────────────────────────
  // Fetchers / builders pra deal scoring + funnel analysis
  // ──────────────────────────────────────────────────────────

  private async fetchDeal(orgId: string, dealId: string): Promise<Deal> {
    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', dealId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Deal ${dealId} not found`);
    return data as Deal;
  }

  private async fetchPipeline(
    orgId: string,
    pipelineId: string,
  ): Promise<{ id: string; name: string; settings: Record<string, unknown> }> {
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('id, name, settings')
      .eq('org_id', orgId)
      .eq('id', pipelineId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    return {
      id: data.id as string,
      name: data.name as string,
      settings: (data.settings as Record<string, unknown> | null) ?? {},
    };
  }

  private async fetchPipelineStages(
    pipelineId: string,
  ): Promise<Array<{ id: string; name: string; position: number; probability: number; sla_hours: number | null; is_won: boolean; is_lost: boolean }>> {
    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, name, position, probability, sla_hours, is_won, is_lost')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[];
  }

  /**
   * Active deals via v_deal_board (já tem stage_probability + hours_in_stage
   * + sla_breached pre-computados pela view).
   */
  private async fetchActiveBoardDeals(
    orgId: string,
    pipelineId: string,
  ): Promise<Array<{
    id: string;
    stage_id: string;
    stage_name: string;
    title: string;
    value: number;
    stage_probability: number;
    hours_in_stage: number;
    sla_breached: boolean;
    sla_hours: number | null;
  }>> {
    const { data, error } = await this.supabase.adminClient
      .from('v_deal_board')
      .select(
        'id, stage_id, stage_name, title, value, stage_probability, hours_in_stage, sla_breached, sla_hours',
      )
      .eq('org_id', orgId)
      .eq('pipeline_id', pipelineId);
    if (error) throw new InternalServerErrorException(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[];
  }

  /** Deals fechados (won OU lost) nos últimos N dias. */
  private async fetchClosedDealsSince(
    orgId: string,
    pipelineId: string,
    days: number,
  ): Promise<Array<Pick<Deal, 'id' | 'value' | 'won_at' | 'lost_at' | 'created_at'>>> {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select('id, value, won_at, lost_at, created_at')
      .eq('org_id', orgId)
      .eq('pipeline_id', pipelineId)
      .or(`won_at.gte.${since},lost_at.gte.${since}`);
    if (error) throw new InternalServerErrorException(error.message);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data ?? []) as any[];
  }

  private async fetchDealActivities(
    orgId: string,
    dealId: string,
    limit: number,
  ): Promise<DealActivity[]> {
    const { data, error } = await this.supabase.adminClient
      .from('deal_activities')
      .select('*')
      .eq('org_id', orgId)
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as DealActivity[];
  }

  private hoursSince(iso: string | null): number {
    if (!iso) return 0;
    const ms = Date.now() - new Date(iso).getTime();
    return Number.isFinite(ms) ? Math.max(0, ms / 3_600_000) : 0;
  }

  // ──────────────────────────────────────────────────────────
  // Prompt builders pra scoreDeal e analyzeFunnel
  // ──────────────────────────────────────────────────────────

  private buildScoreDealPrompt(
    deal: Deal,
    contact: ContactSummary | null,
    messages: Message[],
    activities: DealActivity[],
    hoursInStage: number,
  ): string {
    const lines: string[] = [];

    lines.push('# Deal');
    lines.push(`- Título: ${deal.title}`);
    lines.push(`- Valor: ${deal.currency} ${Number(deal.value).toFixed(2)}`);
    if (deal.expected_close_date) {
      lines.push(`- Data esperada de fechamento: ${deal.expected_close_date}`);
    }
    if (deal.tags?.length) lines.push(`- Tags: ${deal.tags.join(', ')}`);
    lines.push(`- Tempo no stage atual: ${hoursInStage.toFixed(1)} horas`);
    if (deal.lost_reason) lines.push(`- Motivo de perda anterior: ${deal.lost_reason}`);
    lines.push('');

    if (contact) {
      lines.push('# Contato');
      if (contact.name) lines.push(`- Nome: ${contact.name}`);
      if (contact.phone) lines.push(`- Telefone: ${contact.phone}`);
      if (contact.temperature) lines.push(`- Temperatura: ${contact.temperature}`);
      if (contact.score !== null) lines.push(`- Score atual: ${contact.score}/100`);
      if (contact.tags?.length) lines.push(`- Tags: ${contact.tags.join(', ')}`);
      if (contact.ai_summary) lines.push(`- Resumo IA: ${contact.ai_summary}`);
      lines.push('');
    }

    lines.push(`# Conversa (últimas ${messages.length} mensagens)`);
    if (messages.length === 0) {
      lines.push('(deal sem conversa vinculada)');
    } else {
      messages.forEach((m, i) => lines.push(`${i + 1}. ${formatMessageLine(m)}`));
    }
    lines.push('');

    lines.push('# Atividades recentes do deal');
    if (activities.length === 0) {
      lines.push('(sem atividades registradas)');
    } else {
      activities.forEach((a, i) => {
        const when = new Date(a.created_at).toISOString().slice(0, 16).replace('T', ' ');
        lines.push(`${i + 1}. [${when}] ${a.activity_type}: ${a.title ?? '—'}`);
      });
    }

    return lines.join('\n');
  }

  private buildFunnelPrompt(input: {
    pipelineName: string;
    stages: Array<{ id: string; name: string; position: number; sla_hours: number | null }>;
    activeDeals: Array<{
      stage_id: string;
      stage_name: string;
      value: number;
      hours_in_stage: number;
      sla_breached: boolean;
      sla_hours: number | null;
    }>;
    closedRecent: { won: number; lost: number };
    metrics: {
      totalValue: number;
      weightedValue: number;
      avgCycleDays: number;
      conversionRate: number;
    };
  }): string {
    const { pipelineName, stages, activeDeals, closedRecent, metrics } = input;
    const lines: string[] = [];

    lines.push(`# Pipeline: ${pipelineName}`);
    lines.push('');

    lines.push('# Métricas determinísticas (já calculadas — copie no JSON)');
    lines.push(`- total_pipeline_value: ${metrics.totalValue}`);
    lines.push(`- weighted_value: ${metrics.weightedValue}`);
    lines.push(`- avg_cycle_days: ${metrics.avgCycleDays}`);
    lines.push(`- conversion_rate: ${metrics.conversionRate.toFixed(4)} (0..1)`);
    lines.push('');

    lines.push('# Fechamentos nos últimos 30 dias');
    lines.push(`- Ganhos: ${closedRecent.won}`);
    lines.push(`- Perdidos: ${closedRecent.lost}`);
    lines.push('');

    lines.push('# Stages do funil');
    for (const s of stages) {
      const stageDeals = activeDeals.filter((d) => d.stage_id === s.id);
      const stageValue = stageDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
      const breached = stageDeals.filter((d) => d.sla_breached).length;
      const avgHours =
        stageDeals.length > 0
          ? stageDeals.reduce((s2, d) => s2 + Number(d.hours_in_stage || 0), 0) /
            stageDeals.length
          : 0;
      lines.push(
        `- "${s.name}" (pos ${s.position}, SLA ${s.sla_hours ?? '—'}h): ${stageDeals.length} deals, R$ ${stageValue.toFixed(2)}, ${breached} fora do SLA, tempo médio ${avgHours.toFixed(1)}h`,
      );
    }

    return lines.join('\n');
  }
}

// ──────────────────────────────────────────────────────────
// Local types & helpers
// ──────────────────────────────────────────────────────────

interface ConversationCore {
  id: string;
  contact_id: string | null;
  channel_type: string;
  message_count: number;
}

interface ContactSummary {
  name: string | null;
  phone: string | null;
  temperature: string | null;
  score: number | null;
  tags: string[];
  ai_summary: string | null;
}

function formatMessageLine(m: Message): string {
  const who =
    m.direction === 'inbound' ? 'CLIENTE' : m.sender_type === 'bot' ? 'BOT' : 'AGENTE';
  const text = (m.plain_text ?? extractInlineText(m)) || `[${m.content_type}]`;
  return `[${who}] ${truncate(text, 400)}`;
}

function extractInlineText(m: Message): string | null {
  const c = m.content as Record<string, unknown> | null;
  if (!c) return null;
  if (typeof c.body === 'string') return c.body;
  if (typeof c.caption === 'string') return c.caption;
  if (typeof c.filename === 'string') return c.filename;
  return null;
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ──────────────────────────────────────────────────────────
// fill-field: tipos + prompt
// ──────────────────────────────────────────────────────────

interface FillContext {
  summary: string;
  messageLines: string;
  conversationId?: string;
  contactId?: string;
}

interface DealCtx {
  title: string;
  value: number | null;
  currency: string;
  ai_score: number;
  ai_risk: string | null;
  ai_next_action: string | null;
  conversation_id: string | null;
  contact_id: string | null;
  custom_fields: Record<string, unknown>;
  contact:
    | {
        name: string | null;
        phone: string | null;
        ai_summary: string | null;
        temperature: string | null;
        tags: string[] | null;
      }
    | Array<{
        name: string | null;
        phone: string | null;
        ai_summary: string | null;
        temperature: string | null;
        tags: string[] | null;
      }>
    | null;
  stage: { name: string } | Array<{ name: string }> | null;
}

interface ContactCtx {
  name: string | null;
  phone: string | null;
  email: string | null;
  temperature: string | null;
  score: number;
  ai_summary: string | null;
  tags: string[] | null;
  custom_fields: Record<string, unknown>;
}

interface CompanyCtx {
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  custom_fields: Record<string, unknown>;
}

interface TaskCtx {
  title: string;
  task_type: string | null;
  priority: string | null;
  status: string | null;
  due_date: string | null;
  deal_id: string | null;
  contact_id: string | null;
}

const FILL_FIELD_SYSTEM_PROMPT = `Você é um assistente que preenche campos de CRM em português do Brasil.
Receba informações sobre uma entidade (deal/contato/empresa/tarefa) e o histórico
da conversa, e gere o conteúdo apropriado pro campo solicitado.

Regras:
- Responda APENAS com o conteúdo do campo, sem explicações, prefixos ou aspas.
- Seja conciso e direto. Texto plano (sem markdown), no máximo 3 frases curtas
  pra campos descritivos curtos; até 5 linhas pra notas/textareas.
- Se o campo for óbvio pelo contexto (ex: "ai_summary"), produza um resumo;
  se for descritivo (ex: "description" de tarefa), descreva a ação;
  se for nota livre, capture a próxima ação ou observação relevante.
- Se faltar contexto, faça uma sugestão genérica útil em vez de retornar vazio.
- Não invente nomes, valores ou datas que não estejam nos dados fornecidos.`;

/**
 * Heurística leve pra detectar perguntas em PT-BR e EN. Não é perfeita —
 * a UI mostra ❓ quando true e ⚠️ quando false (mensagem inbound sem
 * resposta mas sem ponto de interrogação claro).
 */
function looksLikeQuestion(text: string): boolean {
  if (!text) return false;
  if (/[?？]/.test(text)) return true;
  // Marcadores interrogativos comuns em PT-BR + alguns em inglês
  return /^(?:quanto|quando|onde|como|qual|quem|por que|porque|posso|consegue|consigo|tem|how|what|when|where|why|who|can|could|do you|does)/i.test(
    text.trim(),
  );
}
