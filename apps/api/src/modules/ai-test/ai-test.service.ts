import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AiSkill,
  AiTestConversation,
  AiTestMessage,
  AiTestResponseMetadata,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AnthropicClient } from '../ai/anthropic.client';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import { AiSkillsService } from '../ai-skills/ai-skills.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { LiveSourcesService } from '../knowledge/live-sources.service';
import {
  CLASSIFY_SCHEMA,
  CLASSIFY_SYSTEM_PROMPT,
  ClassificationResult,
  HAIKU_MODEL_ID,
} from '../ai/ai.types';

/**
 * Toggles que controlam quais fontes alimentam a IA no modo teste.
 * Default = todas ligadas (paridade com produção).
 */
export interface TestSources {
  use_kb?: boolean;
  use_skills?: boolean;
  use_live?: boolean;
}

@Injectable()
export class AiTestService {
  private readonly logger = new Logger(AiTestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly anthropic: AnthropicClient,
    private readonly persona: AiPersonaService,
    private readonly skills: AiSkillsService,
    private readonly knowledge: KnowledgeService,
    private readonly liveSources: LiveSourcesService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Sessões (CRUD)
  // ──────────────────────────────────────────────────────────

  async createSession(
    orgId: string,
    userId: string,
    personaId?: string,
  ): Promise<AiTestConversation> {
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
  // sendTestMessage — paridade com ai.service.suggestResponse
  // ──────────────────────────────────────────────────────────

  /**
   * Simula um cliente. Aplica o MESMO pipeline do suggestResponse de produção:
   *   1. classify (intent/sentiment/temperature)
   *   2. resolve skill ativo (se use_skills)
   *   3. RAG na KB — skill-aware se houver skill, senão semantic plain (se use_kb)
   *   4. Live sources se KB local insuficiente (se use_live)
   *   5. Compose system prompt: persona + skill (se houver)
   *   6. Persiste user + assistant messages na sessão
   *
   * Os toggles `sources` deixam o admin desligar cada alimentação pra
   * comparar quanto cada fonte contribui isoladamente.
   *
   * NÃO envia mensagem real, NÃO cria contato/deal, NÃO dispara automações.
   */
  async sendMessage(
    orgId: string,
    sessionId: string,
    userMessage: string,
    sources: TestSources = {},
  ): Promise<{ session: AiTestConversation; reply: AiTestMessage }> {
    const useKb = sources.use_kb !== false;
    const useSkills = sources.use_skills !== false;
    const useLive = sources.use_live !== false;

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
    const recent: AiTestMessage[] = [...session.messages, userMsg];

    // 1) Classifica em paralelo
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

    const classifyRes = await classifyPromise;
    const classification = classifyRes?.data ?? null;

    // 2) Resolve skill ativo (se toggled on + persona disponível)
    let activeSkill: AiSkill | null = null;
    if (useSkills && persona) {
      activeSkill = await this.skills
        .resolveSkillForMessage({
          orgId,
          persona,
          message: {
            ai_intent: classification?.intent ?? null,
            ai_sentiment: classification?.sentiment ?? null,
            plain_text: userMessage,
          },
          contact: null,
        })
        .catch(() => null);
    }

    // 3) KB — skill-aware se houver skill com filtros, senão semantic plain
    let kbHits: Array<{ id: string; title: string; category: string; content: string; tokens: number | null; metadata: Record<string, unknown>; similarity: number }> = [];
    if (useKb) {
      if (
        activeSkill &&
        (activeSkill.knowledge_source_ids.length > 0 || activeSkill.knowledge_categories.length > 0)
      ) {
        kbHits = await this.knowledge
          .searchSemanticForSkill(orgId, userMessage, {
            source_ids: activeSkill.knowledge_source_ids,
            categories: activeSkill.knowledge_categories,
            intent: classification?.intent ?? null,
          })
          .catch(() => []);
      } else {
        kbHits = await this.knowledge.searchSemantic(orgId, userMessage, 3).catch(() => []);
      }
    }

    // 4) Live sources se KB local insuficiente (mesma heurística da produção)
    let liveContent: string | null = null;
    let liveSourcesUsed: Array<{ id: string; name: string; url: string }> = [];
    if (useLive) {
      const lowResults = kbHits.length < 2;
      const lowSim =
        kbHits.length > 0 &&
        kbHits.reduce((s, h) => s + h.similarity, 0) / kbHits.length < 0.55;
      if (lowResults || lowSim) {
        const live = await this.liveSources.fetchLiveContent(orgId, userMessage).catch(() => null);
        if (live) {
          liveContent = live.content;
          liveSourcesUsed = live.sources_used;
        }
      }
    }

    // 5) Compose system prompt: persona + skill (se houver)
    const startedAt = Date.now();
    const personaSystem = persona ? this.persona.buildSystemPrompt(persona) : DEFAULT_TEST_SYSTEM;
    const systemParts = [personaSystem];
    if (activeSkill) {
      systemParts.push(`SKILL ATIVO: ${activeSkill.name}\n${activeSkill.description}\n\n${activeSkill.system_prompt}`);
    }
    systemParts.push(TEST_REPLY_INSTRUCTION);
    const systemPrompt = systemParts.join('\n\n---\n\n');

    const userPrompt = this.buildResponsePrompt(recent, kbHits, liveContent);

    const reply = await this.anthropic
      .complete<string>({
        interaction_type: 'suggest_response',
        org_id: orgId,
        system: systemPrompt,
        user: userPrompt,
        max_tokens: 512,
      })
      .catch((err) => {
        this.logger.warn(
          `test reply failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });

    const replyText =
      reply?.data?.trim() ??
      '⚠️ Não consegui gerar resposta. Verifique a configuração da IA (ANTHROPIC_API_KEY) e tente de novo.';

    // 6) Metadata pra UI
    const sourcesDisabled: Array<'kb' | 'skills' | 'live'> = [];
    if (!useKb) sourcesDisabled.push('kb');
    if (!useSkills) sourcesDisabled.push('skills');
    if (!useLive) sourcesDisabled.push('live');

    const metadata: AiTestResponseMetadata = {
      ...(classification
        ? {
            intent_detected: classification.intent,
            sentiment: classification.sentiment,
            temperature: classification.temperature,
          }
        : {}),
      knowledge_sources_used: kbHits.map((h) => ({
        id: h.id as unknown as string,
        title: h.title,
        category: h.category,
      })),
      active_skill: activeSkill ? { id: activeSkill.id, name: activeSkill.name } : null,
      live_sources_used: liveSourcesUsed,
      ...(sourcesDisabled.length > 0 ? { sources_disabled: sourcesDisabled } : {}),
      actions_would_take: this.hypotheticalActions(classification),
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

    // 7) Persiste
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
    liveContent: string | null,
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

    if (liveContent) {
      lines.push(
        'DADOS ATUALIZADOS DE FONTES EXTERNAS (consultados agora — informação fresca, prefira essa quando houver conflito com a base local). IMPORTANTE: quando houver URLs no formato [texto](url) ou após " → ", INCLUA-AS DIRETO na resposta ao cliente (não prometa enviar "em poucos segundos" — você JÁ tem os links agora):',
      );
      lines.push(liveContent.length > 4000 ? `${liveContent.slice(0, 4000)}…` : liveContent);
      lines.push('');
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
