import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AiAgentPersona, AiPersonaTone, AiPersonaResponseLength, AiPersonaRole } from '@eclick-active/shared';
import { getPersonaTemplate, PERSONA_TEMPLATES } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreatePersonaDto, UpdatePersonaDto } from './dto/persona.dto';

export interface ApplyTemplateResult {
  persona: AiAgentPersona;
  applied: {
    template_id: string;
    business_context_set: boolean;
    appointment_types_created: number;
  };
}

@Injectable()
export class AiPersonaService {
  private readonly logger = new Logger(AiPersonaService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────

  async list(orgId: string): Promise<AiAgentPersona[]> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('*')
      .eq('org_id', orgId)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as AiAgentPersona[];
  }

  async getDefault(orgId: string): Promise<AiAgentPersona | null> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .eq('is_active', true)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return (data as AiAgentPersona | null) ?? null;
  }

  async getById(orgId: string, id: string): Promise<AiAgentPersona> {
    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Persona ${id} não encontrada`);
    return data as AiAgentPersona;
  }

  async create(orgId: string, dto: CreatePersonaDto): Promise<AiAgentPersona> {
    // Se vai ser default, desmarca o anterior pra não violar partial unique
    if (dto.is_default) {
      await this.unsetCurrentDefault(orgId);
    }

    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .insert({
        org_id: orgId,
        name: dto.name,
        avatar_url: dto.avatar_url ?? null,
        role: dto.role ?? 'sales_assistant',
        personality: dto.personality ?? null,
        tone: dto.tone ?? 'semiformal',
        response_length: dto.response_length ?? 'medium',
        language: dto.language ?? 'pt-BR',
        response_delay_seconds: dto.response_delay_seconds ?? 0,
        guidelines: dto.guidelines ?? [],
        forbidden_topics: dto.forbidden_topics ?? [],
        greeting_message: dto.greeting_message ?? null,
        fallback_message: dto.fallback_message ?? null,
        is_default: dto.is_default ?? false,
        is_active: dto.is_active ?? true,
        settings: dto.settings ?? {},
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`create persona failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create persona');
    }
    return data as AiAgentPersona;
  }

  async update(orgId: string, id: string, dto: UpdatePersonaDto): Promise<AiAgentPersona> {
    await this.getById(orgId, id);

    if (dto.is_default) {
      await this.unsetCurrentDefault(orgId, id);
    }

    const { data, error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .update({
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.avatar_url !== undefined ? { avatar_url: dto.avatar_url ?? null } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.personality !== undefined ? { personality: dto.personality ?? null } : {}),
        ...(dto.tone !== undefined ? { tone: dto.tone } : {}),
        ...(dto.response_length !== undefined ? { response_length: dto.response_length } : {}),
        ...(dto.language !== undefined ? { language: dto.language } : {}),
        ...(dto.response_delay_seconds !== undefined ? { response_delay_seconds: dto.response_delay_seconds } : {}),
        ...(dto.guidelines !== undefined ? { guidelines: dto.guidelines } : {}),
        ...(dto.forbidden_topics !== undefined ? { forbidden_topics: dto.forbidden_topics } : {}),
        ...(dto.greeting_message !== undefined ? { greeting_message: dto.greeting_message ?? null } : {}),
        ...(dto.fallback_message !== undefined ? { fallback_message: dto.fallback_message ?? null } : {}),
        ...(dto.is_default !== undefined ? { is_default: dto.is_default } : {}),
        ...(dto.is_active !== undefined ? { is_active: dto.is_active } : {}),
        ...(dto.settings !== undefined ? { settings: dto.settings } : {}),
      })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`update persona failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update persona');
    }
    return data as AiAgentPersona;
  }

  async setDefault(orgId: string, id: string): Promise<AiAgentPersona> {
    return this.update(orgId, id, { is_default: true, is_active: true });
  }

  async delete(orgId: string, id: string): Promise<void> {
    const persona = await this.getById(orgId, id);

    // Não pode deletar a única persona ativa da org
    const all = await this.list(orgId);
    const otherActive = all.filter((p) => p.id !== id && p.is_active);
    if (persona.is_active && otherActive.length === 0) {
      throw new ConflictException(
        'Não pode deletar a única persona ativa. Crie outra antes ou desative essa.',
      );
    }

    const { error } = await this.supabase.adminClient
      .from('ai_agent_personas')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
  }

  // ──────────────────────────────────────────────────────────
  // System prompt builder — coração da personalização
  // ──────────────────────────────────────────────────────────

  /**
   * Transforma a persona em um system prompt rico que vai para a Anthropic.
   * Esse prompt é prepended ANTES do system prompt específico da feature
   * (suggest, classify, etc.) — o segundo system permanece pra dar
   * instruções estruturais (formato JSON, etc.); a persona dá identidade.
   */
  buildSystemPrompt(persona: AiAgentPersona): string {
    const lines: string[] = [];

    lines.push(`Você é ${persona.name}, ${this.roleDescription(persona.role)}.`);
    lines.push('');

    if (persona.personality) {
      lines.push('PERSONALIDADE:');
      lines.push(persona.personality);
      lines.push('');
    }

    lines.push('TOM DE VOZ:');
    lines.push(this.toneDescription(persona.tone));
    lines.push('');

    lines.push('TAMANHO DAS RESPOSTAS:');
    lines.push(this.lengthDescription(persona.response_length));
    lines.push('');

    lines.push(`IDIOMA: Responda sempre em ${persona.language}.`);
    lines.push('');

    if (persona.guidelines.length > 0) {
      lines.push('DIRETRIZES OBRIGATÓRIAS:');
      for (const g of persona.guidelines) {
        lines.push(`- ${g}`);
      }
      lines.push('');
    }

    if (persona.forbidden_topics.length > 0) {
      lines.push('ASSUNTOS PROIBIDOS (nunca fale sobre):');
      for (const t of persona.forbidden_topics) {
        lines.push(`- ${t}`);
      }
      lines.push('');
    }

    if (persona.fallback_message) {
      lines.push(`QUANDO NÃO SOUBER RESPONDER: ${persona.fallback_message}`);
    }

    return lines.join('\n').trim();
  }

  private roleDescription(role: AiPersonaRole): string {
    switch (role) {
      case 'sales_assistant':
        return 'um assistente comercial especializado em qualificar leads, conduzir conversas pra venda e tirar dúvidas sobre produtos';
      case 'support_agent':
        return 'um agente de suporte focado em resolver problemas, esclarecer dúvidas técnicas e garantir satisfação do cliente';
      case 'receptionist':
        return 'uma recepcionista virtual que dá boas-vindas, coleta informações iniciais e direciona o cliente pra área certa';
      case 'custom':
        return 'um assistente customizado seguindo as diretrizes específicas da empresa';
    }
  }

  private toneDescription(tone: AiPersonaTone): string {
    switch (tone) {
      case 'formal':
        return 'Use linguagem profissional e respeitosa. Evite gírias. Trate o interlocutor por "senhor"/"senhora" quando apropriado.';
      case 'semiformal':
        return 'Profissional mas acessível. Use "você", evite gírias mas pode ser caloroso.';
      case 'casual':
        return 'Descontraído. Use linguagem do dia-a-dia, leves coloquialismos quando se encaixarem.';
      case 'friendly':
        return 'Muito amigável e próximo. Pode usar emojis ocasionais (com moderação) e linguagem afetiva.';
    }
  }

  private lengthDescription(length: AiPersonaResponseLength): string {
    switch (length) {
      case 'short':
        return 'Máximo 2 frases. Seja direto ao ponto.';
      case 'medium':
        return '2 a 4 frases. Equilibrado entre completude e concisão.';
      case 'detailed':
        return 'Pode usar 4 a 6 frases quando o contexto pedir. Explique bem.';
    }
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────
  // Templates por nicho — aplicar onboarding completo
  // ──────────────────────────────────────────────────────────

  /** Lista todos os templates disponíveis (pra UI exibir). */
  listTemplates(): typeof PERSONA_TEMPLATES {
    return PERSONA_TEMPLATES;
  }

  /**
   * Aplica um template à org:
   *   1. Atualiza/cria a persona DEFAULT com fields do template
   *   2. Mergeia organizations.settings.ai_concierge.business_context
   *   3. (opcional) Cria appointment_types do template (se ainda não existem)
   *
   * Idempotente: rodar 2x não duplica appointment_types.
   */
  async applyTemplate(
    orgId: string,
    templateId: string,
    opts: { create_appointment_types?: boolean } = {},
  ): Promise<ApplyTemplateResult> {
    const template = getPersonaTemplate(templateId);
    if (!template) {
      throw new NotFoundException(`Template ${templateId} não encontrado`);
    }

    // 1. Persona — atualiza default existente, cria se não houver
    const existingDefault = await this.getDefault(orgId);
    let persona: AiAgentPersona;
    const personaPatch = {
      name: template.persona.name,
      role: template.persona.role,
      tone: template.persona.tone,
      personality: template.persona.personality,
      guidelines: template.persona.guidelines,
      forbidden_topics: template.persona.forbidden_topics,
      greeting_message: template.persona.greeting_message,
      fallback_message: template.persona.fallback_message,
    };
    if (existingDefault) {
      persona = await this.update(orgId, existingDefault.id, personaPatch);
    } else {
      persona = await this.create(orgId, {
        ...personaPatch,
        is_default: true,
        is_active: true,
        response_length: 'medium',
        language: 'pt-BR',
      });
    }

    // 2. business_context — mergeia em settings.ai_concierge
    const { data: orgRow } = await this.supabase.adminClient
      .from('organizations')
      .select('settings')
      .eq('id', orgId)
      .maybeSingle();
    const settings =
      ((orgRow as { settings: Record<string, unknown> | null } | null)?.settings ??
        {}) as Record<string, unknown>;
    const ai = (settings.ai_concierge as Record<string, unknown> | undefined) ?? {};
    const newSettings = {
      ...settings,
      ai_concierge: { ...ai, business_context: template.business_context },
    };
    await this.supabase.adminClient
      .from('organizations')
      .update({ settings: newSettings })
      .eq('id', orgId);

    // 3. Appointment types — opcional. Cria só os que não existem (match por name).
    let appointmentTypesCreated = 0;
    if (opts.create_appointment_types && template.suggested_appointment_types.length > 0) {
      const { data: existing } = await this.supabase.adminClient
        .from('appointment_types')
        .select('name')
        .eq('org_id', orgId);
      const existingNames = new Set(
        ((existing ?? []) as Array<{ name: string }>).map((r) => r.name.toLowerCase()),
      );

      for (const t of template.suggested_appointment_types) {
        if (existingNames.has(t.name.toLowerCase())) continue;
        const { error } = await this.supabase.adminClient
          .from('appointment_types')
          .insert({
            org_id: orgId,
            name: t.name,
            description: t.description,
            duration_minutes: t.duration_minutes,
            buffer_minutes: t.buffer_minutes,
            location_type: t.location_type,
            color: t.color,
            custom_fields_schema: t.custom_fields_schema,
            min_advance_hours: 2,
            max_per_day: 10,
            is_active: true,
            metadata: { source: 'persona_template', template_id: templateId },
          });
        if (!error) appointmentTypesCreated++;
      }
    }

    this.logger.log(
      `applyTemplate ${templateId} → org ${orgId}: persona ok, ctx ok, types=${appointmentTypesCreated}`,
    );

    return {
      persona,
      applied: {
        template_id: templateId,
        business_context_set: true,
        appointment_types_created: appointmentTypesCreated,
      },
    };
  }

  private async unsetCurrentDefault(orgId: string, exceptId?: string): Promise<void> {
    let q = this.supabase.adminClient
      .from('ai_agent_personas')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('is_default', true);
    if (exceptId) q = q.neq('id', exceptId);
    const { error } = await q;
    if (error) {
      this.logger.warn(`unsetCurrentDefault: ${error.message}`);
      throw new BadRequestException('Falha ao desmarcar persona default anterior');
    }
  }
}
