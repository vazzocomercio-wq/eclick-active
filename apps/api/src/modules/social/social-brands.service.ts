import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { AiPersonaService } from '../ai-persona/ai-persona.service';
import type { SocialBrand, BrandContext } from './social.types';
import type { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';

/**
 * Service de marcas (brands) do Social AI Studio.
 *
 * Cada org pode ter múltiplas marcas — útil pra agências. Cada marca
 * carrega: identidade, tom de voz, vínculos com persona/KB, inspirações.
 *
 * O método `getContext()` é o ponto crítico: monta o pacote completo de
 * contexto pra alimentar a IA na geração de conteúdos. Faz RAG search
 * nas categorias de KB selecionadas + puxa persona se vinculada.
 */
@Injectable()
export class SocialBrandsService {
  private readonly log = new Logger(SocialBrandsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly knowledge: KnowledgeService,
    private readonly persona: AiPersonaService,
  ) {}

  async create(orgId: string, dto: CreateBrandDto): Promise<SocialBrand> {
    if (!dto.name?.trim()) {
      throw new BadRequestException('Nome da marca é obrigatório');
    }
    const slug = dto.slug ?? this.slugify(dto.name);
    const { data, error } = await this.supabase.adminClient
      .from('social_brands')
      .insert({ ...dto, slug, org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialBrand;
  }

  async findAll(orgId: string): Promise<SocialBrand[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_brands')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SocialBrand[];
  }

  async findById(orgId: string, id: string): Promise<SocialBrand> {
    const { data, error } = await this.supabase.adminClient
      .from('social_brands')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Marca não encontrada');
    return data as SocialBrand;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateBrandDto,
  ): Promise<SocialBrand> {
    const { data, error } = await this.supabase.adminClient
      .from('social_brands')
      .update(dto)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialBrand;
  }

  async delete(orgId: string, id: string): Promise<void> {
    // Soft delete: marca como inativa em vez de DELETE — preserva histórico
    // de conteúdos que referenciam essa marca.
    await this.update(orgId, id, { is_active: false });
  }

  /**
   * Sincroniza marca com persona vinculada (puxa tom de voz). Idempotente.
   */
  async syncFromPersona(orgId: string, brandId: string): Promise<SocialBrand> {
    const brand = await this.findById(orgId, brandId);
    if (!brand.persona_id) {
      throw new BadRequestException(
        'Marca não tem persona vinculada — vincule primeiro em update.',
      );
    }
    const persona = await this.persona.getDefault(orgId);
    if (!persona || persona.id !== brand.persona_id) {
      throw new NotFoundException('Persona não encontrada');
    }
    // Persona traz tom; marca espelha.
    return this.update(orgId, brandId, {
      tone_of_voice: persona.tone ?? brand.tone_of_voice,
    });
  }

  /**
   * Monta contexto completo da marca pra alimentar IA. RAG search nas
   * categorias da KB + persona vinculada. Idempotente, cacheável.
   */
  async getContext(orgId: string, brandId: string): Promise<BrandContext> {
    const brand = await this.findById(orgId, brandId);

    // Knowledge summary via RAG nas categorias selecionadas
    let knowledgeSummary = '';
    if (brand.knowledge_categories.length > 0) {
      try {
        const query = `${brand.niche ?? ''} ${brand.value_proposition ?? ''}`.trim();
        if (query) {
          const hits = await this.knowledge.searchSemanticForSkill(orgId, query, {
            source_ids: [],
            categories: brand.knowledge_categories,
            intent: null,
          });
          knowledgeSummary = hits
            .slice(0, 8)
            .map((h, i) => {
              const snippet = (h.content ?? '').slice(0, 200).replace(/\s+/g, ' ');
              return `${i + 1}. ${h.title}: ${snippet}`;
            })
            .join('\n');
        }
      } catch (err) {
        this.log.warn(`getContext KB search falhou: ${String(err)}`);
      }
    }

    // Persona vinculada
    let personaInfo: { name: string; system_prompt: string } | null = null;
    if (brand.persona_id) {
      try {
        const p = await this.persona.getDefault(orgId);
        if (p && p.id === brand.persona_id) {
          // Persona não tem system_prompt direto; reusamos
          // buildSystemPrompt() do AiPersonaService quando disponível,
          // ou montamos texto manualmente.
          const builder = (
            this.persona as unknown as {
              buildSystemPrompt?: (persona: unknown) => string;
            }
          ).buildSystemPrompt;
          const systemPrompt =
            (typeof builder === 'function' ? builder.call(this.persona, p) : null) ??
            [
              p.personality,
              `Tom: ${p.tone}`,
              p.guidelines.length > 0 ? `Diretrizes: ${p.guidelines.join('; ')}` : '',
            ]
              .filter(Boolean)
              .join('\n');
          personaInfo = { name: p.name, system_prompt: systemPrompt };
        }
      } catch {
        /* persona indisponível, segue sem */
      }
    }

    return {
      identity: {
        name: brand.name,
        niche: brand.niche,
        value_proposition: brand.value_proposition,
        target_audience: brand.target_audience,
        tone: brand.tone_of_voice,
        primary_color: brand.primary_color,
        secondary_color: brand.secondary_color,
        logo_url: brand.logo_url,
      },
      content_rules: {
        forbidden_words: brand.forbidden_words,
        preferred_words: brand.preferred_words,
        emoji_usage: brand.emoji_usage,
        hashtag_strategy: brand.hashtag_strategy,
      },
      business: {
        pain_points: brand.pain_points,
        differentials: brand.differentials,
        main_cta: brand.main_cta,
      },
      knowledge_summary: knowledgeSummary,
      persona: personaInfo,
    };
  }

  private slugify(name: string): string {
    return name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || `brand-${Date.now()}`;
  }
}
