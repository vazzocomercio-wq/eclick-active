import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Json, Message } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { AnthropicClient } from './anthropic.client';
import {
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  ClassificationResult,
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

    return classification;
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
  ): Promise<SuggestionResult> {
    const conversation = await this.fetchConversationCore(orgId, conversationId);
    const contact = conversation.contact_id
      ? await this.fetchContactSummary(orgId, conversation.contact_id)
      : null;
    const recent = await this.fetchRecentMessages(orgId, conversationId, 15);

    const userPrompt = this.buildSuggestPrompt(contact, recent);

    const { data: suggestion } = await this.anthropic.complete<SuggestionResult>({
      interaction_type: 'suggest_response',
      org_id: orgId,
      system: SUGGEST_SYSTEM_PROMPT,
      user: userPrompt,
      schema: SUGGEST_SCHEMA,
      max_tokens: 768,
      context: {
        conversation_id: conversationId,
        contact_id: conversation.contact_id ?? undefined,
      },
    });

    // Clamp confidence em [0, 1] — schema não permite minimum/maximum
    const confidence = Math.max(0, Math.min(1, Number(suggestion.confidence) || 0));

    return { ...suggestion, confidence };
  }

  // ──────────────────────────────────────────────────────────
  // c) summarizeConversation
  // ──────────────────────────────────────────────────────────

  /**
   * Gera resumo de 2-3 frases e atualiza conversation.ai_summary.
   * Output é texto livre (sem json_schema) — mais natural pro modelo.
   */
  async summarizeConversation(orgId: string, conversationId: string): Promise<string> {
    const recent = await this.fetchRecentMessages(orgId, conversationId, 30);
    if (recent.length === 0) {
      return '';
    }

    const userPrompt = this.buildSummarizePrompt(recent);

    const { data: summary } = await this.anthropic.complete<string>({
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

    return trimmed;
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
  // Orquestração: processInbound (chamado fire-and-forget pelo webhook)
  // ──────────────────────────────────────────────────────────

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
      const [classification, suggestion] = await Promise.all([
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
      ]);

      if (suggestion) {
        this.events.emitToOrg(orgId, 'ai:suggestion', {
          conversation_id: conversationId,
          suggestion: suggestion.suggested_response,
          confidence: suggestion.confidence,
        });
      }

      // Trigger summary periodicamente (a cada 5 mensagens). Best-effort.
      const conv = await this.fetchConversationCore(orgId, conversationId).catch(() => null);
      if (conv && conv.message_count > 0 && conv.message_count % 5 === 0) {
        void this.summarizeConversation(orgId, conversationId).catch(() => {});
      }

      this.logger.debug(
        `processInbound done conv=${conversationId} classified=${!!classification} suggested=${!!suggestion}`,
      );
    } catch (err) {
      this.logger.error(
        `processInbound failed: ${err instanceof Error ? err.message : String(err)}`,
      );
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

  private buildSuggestPrompt(contact: ContactSummary | null, recent: Message[]): string {
    const lines: string[] = [];
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
