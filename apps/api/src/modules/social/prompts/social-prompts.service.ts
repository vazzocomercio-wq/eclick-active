import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';

/**
 * Overrides editáveis de estilos de vídeo / frameworks / system prompts
 * (Estúdio de Estilos — B1). Armazenamento esparso em
 * active.social_prompt_overrides; o código continua sendo o fallback.
 *
 * Também gera/melhora prompts por IA (botão "✨ Gerar com IA").
 */

export type PromptKind = 'video_style' | 'framework' | 'system_prompt';

export interface PromptOverride {
  id: string;
  org_id: string;
  kind: PromptKind;
  key: string;
  label: string | null;
  prompt: string;
  camera: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertOverrideDto {
  kind: PromptKind;
  key: string;
  label?: string | null;
  prompt: string;
  camera?: string | null;
  is_active?: boolean;
}

export interface GeneratePromptDto {
  kind: PromptKind;
  key: string;
  /** O que o usuário quer (linguagem natural). */
  instruction: string;
  /** Prompt atual (pra melhorar em vez de criar do zero). */
  current_prompt?: string;
  /** Rótulo do estilo/framework, pra dar contexto. */
  label?: string;
}

@Injectable()
export class SocialPromptsService {
  private readonly log = new Logger(SocialPromptsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
  ) {}

  async list(orgId: string): Promise<PromptOverride[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_prompt_overrides')
      .select('*')
      .eq('org_id', orgId);
    if (error) throw error;
    return (data ?? []) as PromptOverride[];
  }

  async upsert(orgId: string, dto: UpsertOverrideDto): Promise<PromptOverride> {
    if (!dto.kind || !dto.key) throw new Error('kind e key obrigatórios');
    const { data, error } = await this.supabase.adminClient
      .from('social_prompt_overrides')
      .upsert(
        {
          org_id: orgId,
          kind: dto.kind,
          key: dto.key,
          label: dto.label ?? null,
          prompt: dto.prompt ?? '',
          camera: dto.camera ?? null,
          is_active: dto.is_active ?? true,
        },
        { onConflict: 'org_id,kind,key' },
      )
      .select('*')
      .single();
    if (error) throw error;
    return data as PromptOverride;
  }

  async reset(orgId: string, kind: PromptKind, key: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_prompt_overrides')
      .delete()
      .eq('org_id', orgId)
      .eq('kind', kind)
      .eq('key', key);
    if (error) throw error;
  }

  /**
   * Resolve um system prompt: usa o override (se existir e ativo) ou o
   * fallback do código. Chamado pelo gerador.
   */
  async getSystemPrompt(
    orgId: string,
    key: string,
    fallback: string,
  ): Promise<string> {
    try {
      const { data } = await this.supabase.adminClient
        .from('social_prompt_overrides')
        .select('prompt, is_active')
        .eq('org_id', orgId)
        .eq('kind', 'system_prompt')
        .eq('key', key)
        .maybeSingle();
      const row = data as { prompt?: string; is_active?: boolean } | null;
      if (row?.is_active && row.prompt?.trim()) return row.prompt;
    } catch (e) {
      this.log.warn(`getSystemPrompt(${key}) fallback: ${(e as Error).message}`);
    }
    return fallback;
  }

  /** Gera/melhora um prompt via IA a partir da intenção do usuário. */
  async generate(orgId: string, dto: GeneratePromptDto): Promise<{ prompt: string }> {
    const kindDesc =
      dto.kind === 'video_style'
        ? 'a DIREÇÃO VISUAL (em inglês) pro motor de vídeo image-to-video: movimento de câmera, ritmo, mood, composição — curto e específico, sem texto na tela'
        : dto.kind === 'framework'
          ? 'a dica de ESTRUTURA DE ROTEIRO (pt-BR) que molda a legenda/copy'
          : 'um SYSTEM PROMPT (instrução central pra IA de conteúdo)';
    const system = `Você ajuda a escrever PROMPTS para um estúdio de conteúdo social com IA.
Escreva ${kindDesc}.
Responda APENAS com o texto do prompt — sem aspas, sem explicação, sem markdown.`;
    const user = [
      `ITEM: ${dto.label || dto.key} (${dto.kind})`,
      dto.current_prompt ? `PROMPT ATUAL:\n${dto.current_prompt}` : '',
      `INTENÇÃO DO USUÁRIO: ${dto.instruction}`,
    ]
      .filter(Boolean)
      .join('\n\n');
    const result = await this.llm.chat({
      orgId,
      feature: 'social_prompt_builder',
      system,
      user,
      max_tokens: 800,
      temperature: 0.6,
    });
    return { prompt: (result.text ?? '').trim() };
  }
}
