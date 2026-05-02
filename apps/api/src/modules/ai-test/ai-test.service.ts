import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AiAgentPersona,
  AiTestConversation,
  AiTestMessage,
  AiTestResponseMetadata,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AnthropicClient } from '../ai/anthropic.client';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import {
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  ClassificationResult,
  HAIKU_MODEL_ID,
} from '../ai/ai.types';

@Injectable()
export class AiTestService {
  private readonly logger = new Logger(AiTestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly anthropic: AnthropicClient,
    private readonly persona: AiPersonaService,
    private readonly knowledge: KnowledgeService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Sessões (CRUD)
  // ──────────────────────────────────────────────────────────

  async createSession(
    orgId: string,
    userId: string,
    personaId?: string,
  ): Promise<AiTestConversation> {
    // Resolve persona — usa default da org se não passar id
    let resolvedPersonaId: string | null = null;
    if (personaId) {
      const p = await this.persona.getById(orgId, personaId);
      resolvedPersonaId = p.id;
    } else {
      const def = await this.persona.getDefault(orgId);
      resolvedPersonaId = def?.id ?? null;
    }

    const { data, error } = await this.supabase.adminClient
      .from('ai_test_conversations')
      .insert({
        org_id: orgId,
        user_id: userId,
        persona_id: resolvedPersonaId,
        messages: [],
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar sessão de teste');
    }
    return data as AiTestConversation;
  }

  async getSession(orgId: string, sessionId: string): Promise<AiTestConversation> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_test_conversations')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Sessão ${sessionId} não encontrada`);
    return data as AiTestConversation;
  }

  async listSessions(orgId: string, userId: string): Promise<AiTestConversation[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_test_conversations')
      .select('*')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AiTestConversation[];
  }

  async deleteSession(orgId: string, sessionId: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('ai_test_conversations')
      .delete()
      .eq('org_id', orgId)
      .eq('id', sessionId);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ──────────────────────────────────────────────────────────
  // sendTestMessage — coração do modo teste
  // ──────────────────────────────────────────────────────────

  /**
   * Simula o cliente mandando uma mensagem pra persona. Roda:
   *  1. classify (intent/sentiment/temperature) com Haiku
   *  2. RAG na knowledge base
   *  3. Geração de resposta com persona system prompt + KB
   *  4. Persiste user + assistant na sessão
   *
   * NÃO envia mensagem real, NÃO cria contato/deal, NÃO dispara automações.
   */
  async sendMessage(
    orgId: string,
    sessionId: string,
    userMessage: string,
  ): Promise<{ session: AiTestConversation; reply: AiTestMessage }> {
    const session = await this.getSession(orgId, sessionId);
    const persona = session.persona_id
      ? await this.persona.getById(orgId, session.persona_id).catch(() => null)
      : null;

    const now = new Date().toISOString();
    const userMsg: AiTestMessage = {
      role: 'user',
      content: userMessage,
      timestamp: now,
    };

    // 1) Classifica a mensagem (paralelo c/ KB)
    const recent: AiTestMessage[] = [...session.messages, userMsg];
    const classifyPromise = this.anthropic
      .complete<ClassificationResult>({
        interaction_type: 'classify_intent',
        org_id: orgId,
        system: CLASSIFY_SYSTEM_PROMPT,
        user: this.formatHistoryForPrompt(recent),
        schema: CLASSIFY_SCHEMA,
        max_tokens: 256,
      })
      .catch((err) => {
        this.logger.warn(
          `test classify failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    // 2) RAG na KB usando a mensagem do user
    const kbHitsPromise = this.knowledge
      .searchSemantic(orgId, userMessage, 3)
      .catch(() => []);

    const [classifyRes, kbHits] = await Promise.all([classifyPromise, kbHitsPromise]);

    // 3) Gera resposta usando persona + KB + histórico
    const startedAt = Date.now();
    const personaSystem = persona ? this.persona.buildSystemPrompt(persona) : DEFAULT_TEST_SYSTEM;
    const userPrompt = this.buildResponsePrompt(recent, kbHits);

    const reply = await this.anthropic
      .complete<string>({
        interaction_type: 'suggest_response',
        org_id: orgId,
        system: `${personaSystem}\n\n${TEST_REPLY_INSTRUCTION}`,
        user: userPrompt,
        max_tokens: 512,
      })
      .catch((err) => {
        this.logger.warn(
          `test reply failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    const replyText = reply?.data?.trim() ?? '⚠️ Não consegui gerar resposta. Verifique a configuração da IA (ANTHROPIC_API_KEY) e tente de novo.';

    // 4) Monta metadata pra UI
    const metadata: AiTestResponseMetadata = {
      ...(classifyRes?.data
        ? {
            intent_detected: classifyRes.data.intent,
            sentiment: classifyRes.data.sentiment,
            temperature: classifyRes.data.temperature,
          }
        : {}),
      knowledge_sources_used: kbHits.map((h) => ({
        id: h.id as unknown as string,
        title: h.title,
        category: h.category,
      })),
      actions_would_take: this.hypotheticalActions(classifyRes?.data ?? null),
      model: HAIKU_MODEL_ID,
      ...(reply
        ? {
            input_tokens: reply.input_tokens,
            output_tokens: reply.output_tokens,
            latency_ms: Date.now() - startedAt,
          }
        : {}),
    };

    const assistantMsg: AiTestMessage = {
      role: 'assistant',
      content: replyText,
      timestamp: new Date().toISOString(),
      ai_metadata: metadata,
    };

    // 5) Persiste nas messages jsonb
    const newMessages: AiTestMessage[] = [...session.messages, userMsg, assistantMsg];
    const { data: updated, error } = await this.supabase.adminClient
      .from('ai_test_conversations')
      .update({ messages: newMessages })
      .eq('org_id', orgId)
      .eq('id', sessionId)
      .select('*')
      .single();
    if (error || !updated) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao salvar mensagem de teste');
    }

    return { session: updated as AiTestConversation, reply: assistantMsg };
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  private formatHistoryForPrompt(messages: AiTestMessage[]): string {
    if (messages.length === 0) return '(sem histórico)';
    return messages
      .map((m, i) => {
        const who = m.role === 'user' ? 'CLIENTE' : 'AGENTE';
        return `${i + 1}. [${who}] ${m.content}`;
      })
      .join('\n');
  }

  private buildResponsePrompt(
    messages: AiTestMessage[],
    knowledge: Array<{ title: string; category: string; content: string }>,
  ): string {
    const lines: string[] = [];

    if (knowledge.length > 0) {
      lines.push('Contexto da base de conhecimento (use como verdade):');
      knowledge.forEach((h, i) => {
        const snippet = h.content.length > 600 ? `${h.content.slice(0, 600)}…` : h.content;
        lines.push(`[${i + 1}] ${h.title} (${h.category}):`);
        lines.push(snippet);
        lines.push('');
      });
    }

    lines.push('Conversa (cronológica):');
    if (messages.length === 0) {
      lines.push('(sem mensagens)');
    } else {
      messages.forEach((m, i) => {
        const who = m.role === 'user' ? 'CLIENTE' : 'VOCÊ';
        lines.push(`${i + 1}. [${who}] ${m.content}`);
      });
    }
    lines.push('');
    lines.push(
      'Responda à última mensagem do CLIENTE como se fosse a próxima fala da sua persona — texto plano, sem prefixos ou marcação.',
    );
    return lines.join('\n');
  }

  /**
   * Retorna lista de ações que a IA TOMARIA em modo produção (não modo teste).
   * Tudo é heurístico — útil pra mostrar ao admin o que mudaria no comportamento.
   */
  private hypotheticalActions(c: ClassificationResult | null): string[] {
    if (!c) return [];
    const out: string[] = [];
    if (c.urgency === 'high' || c.urgency === 'critical') {
      out.push('Criaria tarefa urgente pro responsável');
    }
    if (c.intent === 'budget' || c.intent === 'negotiation') {
      out.push('Criaria deal e atribuiria ao funil padrão');
    }
    if (c.intent === 'complaint') {
      out.push('Atribuiria conversa a um especialista de suporte');
    }
    if (c.temperature === 'hot' || c.temperature === 'very_hot') {
      out.push('Aumentaria score do contato');
    }
    if (c.intent === 'farewell') {
      out.push('Sugeriria fechar a conversa');
    }
    return out;
  }
}

const DEFAULT_TEST_SYSTEM = `Você é uma assistente comercial brasileira. Responda de forma profissional e clara.`;

const TEST_REPLY_INSTRUCTION = `Sua tarefa: gerar a próxima resposta da conversa em texto plano (sem JSON, sem prefixos como "Resposta:" ou "Vou responder:"). Apenas a fala, como se fosse enviada diretamente ao cliente.`;
