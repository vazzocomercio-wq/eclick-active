import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  AiAgentPersona,
  AiAgentSkill,
  AiSkill,
  AiSkillAction,
  AiSkillTriggerConditions,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EmbeddingsClient } from '../knowledge/embeddings.client';
import {
  AttachSkillDto,
  CreateSkillDto,
  ReorderSkillsDto,
  UpdateSkillDto,
} from './dto/skill.dto';
import { SYSTEM_SKILLS, type SystemSkillSeed } from './system-skills';

interface MessageInput {
  ai_intent?: string | null;
  ai_sentiment?: string | null;
  plain_text?: string | null;
}

interface ContactInput {
  temperature?: string | null;
}

const SEMANTIC_THRESHOLD = 0.75;

@Injectable()
export class AiSkillsService {
  private readonly logger = new Logger(AiSkillsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly embeddings: EmbeddingsClient,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────

  async list(orgId: string): Promise<AiSkill[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_skills')
      .select('*')
      .eq('org_id', orgId)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AiSkill[];
  }

  async getById(orgId: string, id: string): Promise<AiSkill> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_skills')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Skill ${id} não encontrado`);
    return data as AiSkill;
  }

  async create(
    orgId: string,
    dto: CreateSkillDto,
    createdBy: string | null,
  ): Promise<AiSkill> {
    const conditions = await this.enrichConditionsWithEmbeddings(orgId, dto.trigger_conditions ?? {});

    const { data, error } = await this.supabase.adminClient
      .from('ai_skills')
      .insert({
        org_id: orgId,
        name: dto.name,
        description: dto.description,
        skill_type: 'custom',
        system_prompt: dto.system_prompt,
        knowledge_source_ids: dto.knowledge_source_ids ?? [],
        knowledge_categories: dto.knowledge_categories ?? [],
        allowed_actions: dto.allowed_actions ?? [],
        trigger_conditions: conditions,
        priority: dto.priority ?? 0,
        is_active: dto.is_active ?? true,
        created_by: createdBy,
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`create skill failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar skill');
    }
    return data as AiSkill;
  }

  async update(orgId: string, id: string, dto: UpdateSkillDto): Promise<AiSkill> {
    const existing = await this.getById(orgId, id);

    // System skills só permite is_active e priority — preserva integridade
    if (existing.skill_type === 'system') {
      const allowed: Array<keyof UpdateSkillDto> = ['is_active', 'priority'];
      const blocked = Object.keys(dto).filter((k) => !allowed.includes(k as keyof UpdateSkillDto));
      if (blocked.length > 0) {
        throw new ForbiddenException(
          `System skills só permitem editar: ${allowed.join(', ')}. Bloqueado: ${blocked.join(', ')}`,
        );
      }
    }

    const conditions =
      dto.trigger_conditions !== undefined
        ? await this.enrichConditionsWithEmbeddings(orgId, dto.trigger_conditions)
        : undefined;

    const { data, error } = await this.supabase.adminClient
      .from('ai_skills')
      .update({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.system_prompt !== undefined ? { system_prompt: dto.system_prompt } : {}),
        ...(dto.knowledge_source_ids !== undefined
          ? { knowledge_source_ids: dto.knowledge_source_ids }
          : {}),
        ...(dto.knowledge_categories !== undefined
          ? { knowledge_categories: dto.knowledge_categories }
          : {}),
        ...(dto.allowed_actions !== undefined ? { allowed_actions: dto.allowed_actions } : {}),
        ...(conditions !== undefined ? { trigger_conditions: conditions } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
      })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao atualizar skill');
    }
    return data as AiSkill;
  }

  async delete(orgId: string, id: string): Promise<void> {
    const existing = await this.getById(orgId, id);
    if (existing.skill_type === 'system') {
      throw new ForbiddenException(
        'Não pode deletar skill do sistema. Desative com PATCH is_active=false.',
      );
    }
    const { error } = await this.supabase.adminClient
      .from('ai_skills')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ──────────────────────────────────────────────────────────
  // Seed system skills (idempotente — só cria os que faltam)
  // ──────────────────────────────────────────────────────────

  async seedSystemSkills(orgId: string): Promise<{ created: number; skipped: number }> {
    const { data: existing } = await this.supabase.adminClient
      .from('ai_skills')
      .select('name')
      .eq('org_id', orgId)
      .eq('skill_type', 'system');
    const existingNames = new Set(((existing ?? []) as Array<{ name: string }>).map((r) => r.name));

    let created = 0;
    let skipped = 0;
    for (const seed of SYSTEM_SKILLS) {
      if (existingNames.has(seed.name)) {
        skipped++;
        continue;
      }
      const conditions = await this.enrichConditionsWithEmbeddings(orgId, seed.trigger_conditions);
      const { error } = await this.supabase.adminClient.from('ai_skills').insert({
        org_id: orgId,
        name: seed.name,
        description: seed.description,
        skill_type: 'system',
        system_prompt: seed.system_prompt,
        knowledge_source_ids: [],
        knowledge_categories: seed.knowledge_categories,
        allowed_actions: seed.allowed_actions,
        trigger_conditions: conditions,
        priority: seed.priority,
        is_active: true,
      });
      if (error) {
        this.logger.warn(`seed skill ${seed.name} failed: ${error.message}`);
        continue;
      }
      created++;
    }
    return { created, skipped };
  }

  // ──────────────────────────────────────────────────────────
  // Agent ↔ Skill mapping
  // ──────────────────────────────────────────────────────────

  async listForPersona(orgId: string, personaId: string): Promise<Array<AiSkill & { agent_priority: number; agent_skill_id: string }>> {
    // Resolve persona pra validar org
    const { data: pers, error: pErr } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', personaId)
      .maybeSingle();
    if (pErr) throw new InternalServerErrorException(pErr.message);
    if (!pers) throw new NotFoundException(`Persona ${personaId} não encontrada`);

    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_skills')
      .select('id, priority, is_active, skill:ai_skills(*)')
      .eq('persona_id', personaId)
      .order('priority', { ascending: false });
    if (error) throw new InternalServerErrorException(error.message);

    type Row = {
      id: string;
      priority: number;
      is_active: boolean;
      skill: AiSkill | AiSkill[];
    };
    const rows = (data ?? []) as Row[];
    return rows
      .map((r) => {
        const sk = Array.isArray(r.skill) ? r.skill[0] : r.skill;
        if (!sk) return null;
        return { ...sk, agent_priority: r.priority, agent_skill_id: r.id };
      })
      .filter((x): x is AiSkill & { agent_priority: number; agent_skill_id: string } => x !== null);
  }

  async attachSkillToPersona(
    orgId: string,
    personaId: string,
    dto: AttachSkillDto,
  ): Promise<AiAgentSkill> {
    // Valida que persona e skill pertencem à org
    await this.getById(orgId, dto.skill_id);
    const { data: pers } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', personaId)
      .maybeSingle();
    if (!pers) throw new NotFoundException(`Persona ${personaId} não encontrada`);

    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_skills')
      .insert({
        persona_id: personaId,
        skill_id: dto.skill_id,
        priority: dto.priority ?? 0,
        is_active: true,
      })
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao vincular skill');
    }
    return data as AiAgentSkill;
  }

  async detachSkillFromPersona(orgId: string, personaId: string, skillId: string): Promise<void> {
    // Valida ownership via persona
    const { data: pers } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', personaId)
      .maybeSingle();
    if (!pers) throw new NotFoundException(`Persona ${personaId} não encontrada`);

    const { error } = await this.supabase.adminClient
      .from('ai_agent_skills')
      .delete()
      .eq('persona_id', personaId)
      .eq('skill_id', skillId);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async reorderPersonaSkills(
    orgId: string,
    personaId: string,
    dto: ReorderSkillsDto,
  ): Promise<void> {
    // Valida persona
    const { data: pers } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('id')
      .eq('org_id', orgId)
      .eq('id', personaId)
      .maybeSingle();
    if (!pers) throw new NotFoundException(`Persona ${personaId} não encontrada`);

    // Atribui priority decrescente conforme ordem do array (primeiro = maior)
    const updates = dto.skill_ids.map(async (sid, idx) => {
      const priority = dto.skill_ids.length - idx;
      return this.supabase.adminClient
        .from('ai_agent_skills')
        .update({ priority })
        .eq('persona_id', personaId)
        .eq('skill_id', sid);
    });
    const results = await Promise.all(updates);
    for (const r of results) {
      if (r.error) {
        throw new InternalServerErrorException(r.error.message);
      }
    }
  }

  // ──────────────────────────────────────────────────────────
  // Resolução de skill pra mensagem
  // ──────────────────────────────────────────────────────────

  /**
   * Encontra qual skill ativar pra uma mensagem inbound.
   * Retorna o skill de maior prioridade entre os que casam, ou null se nenhum.
   *
   * Regras de match:
   *   - intents: ai_intent IN trigger_conditions.intents (OR-match)
   *   - temperatures: contact.temperature IN trigger_conditions.temperatures
   *   - sentiments: ai_sentiment IN trigger_conditions.sentiments
   *   - custom_phrases: similaridade semântica >= 0.75 (ou substring fallback)
   *
   * Se múltiplas conditions estiverem setadas, basta UMA casar pra o skill ativar.
   */
  async resolveSkillForMessage(args: {
    orgId: string;
    persona: AiAgentPersona;
    message: MessageInput;
    contact: ContactInput | null;
  }): Promise<AiSkill | null> {
    const skills = await this.listForPersona(args.orgId, args.persona.id);
    const active = skills.filter((s) => s.is_active && (s as { is_active: boolean }).is_active !== false);
    if (active.length === 0) return null;

    // Embedding da mensagem (uma vez só) pra match semântico
    const text = (args.message.plain_text ?? '').trim();
    const messageEmbedding = text ? await this.embeddings.embed(text, args.orgId).catch(() => null) : null;

    // Itera por priority desc (já ordenado pelo listForPersona)
    for (const skill of active) {
      const matched = await this.matchTriggerConditions({
        skill,
        message: args.message,
        contact: args.contact,
        messageEmbedding,
      });
      if (matched) {
        return skill;
      }
    }
    return null;
  }

  /**
   * Avalia se um skill deve ativar pra mensagem dada. Retorna true se
   * QUALQUER condition match. Se trigger_conditions é vazio, NÃO casa
   * (skill dormente — precisa configuração explícita).
   */
  private async matchTriggerConditions(args: {
    skill: AiSkill;
    message: MessageInput;
    contact: ContactInput | null;
    messageEmbedding: number[] | null;
  }): Promise<boolean> {
    const c = args.skill.trigger_conditions as AiSkillTriggerConditions;
    if (!c || Object.keys(c).length === 0) return false;

    // intents
    if (c.intents && c.intents.length > 0) {
      const intent = args.message.ai_intent ?? null;
      if (intent && c.intents.includes(intent)) return true;
    }

    // temperatures
    if (c.temperatures && c.temperatures.length > 0) {
      const temp = args.contact?.temperature ?? null;
      if (temp && c.temperatures.includes(temp)) return true;
    }

    // sentiments
    if (c.sentiments && c.sentiments.length > 0) {
      const s = args.message.ai_sentiment ?? null;
      if (s && c.sentiments.includes(s)) return true;
    }

    // custom_phrases (semântico ou fallback)
    if (c.custom_phrases && c.custom_phrases.length > 0) {
      const text = (args.message.plain_text ?? '').toLowerCase();
      if (!text) return false;

      // Tentativa 1: semântico via embeddings (melhor)
      if (args.messageEmbedding && c.phrase_embeddings && c.phrase_embeddings.length > 0) {
        for (const pe of c.phrase_embeddings) {
          if (!pe.embedding || !Array.isArray(pe.embedding)) continue;
          const sim = cosineSimilarity(args.messageEmbedding, pe.embedding);
          if (sim >= SEMANTIC_THRESHOLD) return true;
        }
      } else {
        // Tentativa 2 (fallback graceful): substring case-insensitive
        for (const phrase of c.custom_phrases) {
          if (text.includes(phrase.toLowerCase())) return true;
        }
      }
    }

    return false;
  }

  // ──────────────────────────────────────────────────────────
  // Stats: incrementa execution_count + recalcula avg_confidence
  // ──────────────────────────────────────────────────────────

  async recordExecution(skillId: string, confidence: number): Promise<void> {
    // Read-modify-write — janela mínima, não crítico se desincronizar 1
    const { data } = await this.supabase.adminClient
      .from('ai_skills')
      .select('execution_count, avg_confidence')
      .eq('id', skillId)
      .maybeSingle();
    if (!data) return;
    const prev = data as { execution_count: number; avg_confidence: number };
    const n = prev.execution_count + 1;
    const newAvg = (Number(prev.avg_confidence) * prev.execution_count + confidence * 100) / n;
    await this.supabase.adminClient
      .from('ai_skills')
      .update({
        execution_count: n,
        avg_confidence: Math.round(newAvg * 100) / 100,
      })
      .eq('id', skillId);
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Adiciona embeddings das custom_phrases (pra match semântico).
   * Falha gracefully se OpenAI não estiver disponível — match cai pra substring.
   */
  private async enrichConditionsWithEmbeddings(
    orgId: string,
    rawConditions: Record<string, unknown> | AiSkillTriggerConditions,
  ): Promise<AiSkillTriggerConditions> {
    const c = (rawConditions ?? {}) as AiSkillTriggerConditions;
    const phrases = Array.isArray(c.custom_phrases) ? c.custom_phrases : [];
    if (phrases.length === 0) {
      // Remove phrase_embeddings se houver
      const { phrase_embeddings: _ignore, ...rest } = c;
      void _ignore;
      return rest as AiSkillTriggerConditions;
    }

    const embeddings: AiSkillTriggerConditions['phrase_embeddings'] = [];
    for (const phrase of phrases) {
      const emb = await this.embeddings.embed(phrase, orgId).catch(() => null);
      if (emb) embeddings.push({ phrase, embedding: emb });
    }
    return { ...c, phrase_embeddings: embeddings };
  }
}

// ──────────────────────────────────────────────────────────
// Cosine similarity helper
// ──────────────────────────────────────────────────────────

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
