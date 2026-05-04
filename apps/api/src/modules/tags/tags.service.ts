import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CreateTagDefinitionDto,
  TagDefinition,
  TagEntityType,
  UpdateTagDefinitionDto,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';

const TAGS_PER_ORG_CAP = 200;

@Injectable()
export class TagsService {
  private readonly logger = new Logger(TagsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // Read
  // ──────────────────────────────────────────────────────────

  async list(
    orgId: string,
    filters: {
      entity_type?: TagEntityType;
      search?: string;
      category?: string;
    } = {},
  ): Promise<TagDefinition[]> {
    let query = this.supabase.adminClient
      .from('tag_definitions')
      .select('*')
      .eq('org_id', orgId)
      .order('usage_count', { ascending: false })
      .order('label', { ascending: true });

    if (filters.entity_type) {
      query = query.eq('entity_type', filters.entity_type);
    }
    if (filters.category) {
      query = query.eq('category', filters.category);
    }
    if (filters.search?.trim()) {
      const term = filters.search.trim().toLowerCase();
      query = query.or(`label.ilike.*${term}*,slug.ilike.*${term.toUpperCase()}*`);
    }

    const { data, error } = await query;
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as TagDefinition[];
  }

  async findById(orgId: string, id: string): Promise<TagDefinition> {
    const { data, error } = await this.supabase.adminClient
      .from('tag_definitions')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Tag ${id} not found`);
    return data as TagDefinition;
  }

  // ──────────────────────────────────────────────────────────
  // Create / Update / Delete
  // ──────────────────────────────────────────────────────────

  async create(
    orgId: string,
    userId: string | null,
    dto: CreateTagDefinitionDto,
  ): Promise<TagDefinition> {
    const label = (dto.label ?? '').trim();
    if (!label) throw new BadRequestException('label é obrigatório');

    const slug = (dto.slug ?? this.slugify(label)).slice(0, 60);
    if (!slug) throw new BadRequestException('slug inválido (vazio após normalização)');

    if (!['contact', 'deal'].includes(dto.entity_type)) {
      throw new BadRequestException("entity_type deve ser 'contact' ou 'deal'");
    }

    // Cap: no máximo 200 tags por entity_type por org
    const { count } = await this.supabase.adminClient
      .from('tag_definitions')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('entity_type', dto.entity_type);
    if ((count ?? 0) >= TAGS_PER_ORG_CAP) {
      throw new BadRequestException(
        `Limite de ${TAGS_PER_ORG_CAP} tags por tipo (${dto.entity_type}) atingido`,
      );
    }

    const { data, error } = await this.supabase.adminClient
      .from('tag_definitions')
      .insert({
        org_id: orgId,
        entity_type: dto.entity_type,
        label,
        slug,
        color: dto.color ?? null,
        description: dto.description ?? null,
        category: dto.category ?? null,
        usage_count: 0,
        created_by: userId,
      })
      .select('*')
      .single();

    if (error) {
      // Conflito de unique (org_id, entity_type, slug)
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(`Já existe uma tag com slug "${slug}" em ${dto.entity_type}`);
      }
      this.logger.error(`createTag failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return data as TagDefinition;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateTagDefinitionDto,
  ): Promise<TagDefinition> {
    await this.findById(orgId, id); // valida ownership

    const patch: Record<string, unknown> = {};
    if (dto.label !== undefined) {
      const label = dto.label.trim();
      if (!label) throw new BadRequestException('label não pode ficar vazio');
      patch.label = label;
    }
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.category !== undefined) patch.category = dto.category;

    if (Object.keys(patch).length === 0) {
      return this.findById(orgId, id);
    }

    const { data, error } = await this.supabase.adminClient
      .from('tag_definitions')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`updateTag failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update tag');
    }
    return data as TagDefinition;
  }

  async remove(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id); // valida ownership

    const { error } = await this.supabase.adminClient
      .from('tag_definitions')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`removeTag failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // Upsert many (usado pelo Concierge IA + ações em massa)
  // ──────────────────────────────────────────────────────────

  /**
   * Recebe lista de slugs (UPPERCASE_SNAKE_CASE), garante que existam no
   * catálogo, incrementa usage_count nas existentes, cria as novas com
   * label humanizado (ex: "CONVENIO_GAMA" → "Convênio Gama"). Retorna
   * lista completa das definições.
   */
  async upsertMany(
    orgId: string,
    entityType: TagEntityType,
    slugs: string[],
  ): Promise<TagDefinition[]> {
    const cleaned = Array.from(
      new Set(
        slugs
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => this.slugify(s).slice(0, 60))
          .filter((s) => s.length > 0),
      ),
    );
    if (cleaned.length === 0) return [];

    // Pega definições existentes
    const { data: existing, error: existingErr } = await this.supabase.adminClient
      .from('tag_definitions')
      .select('*')
      .eq('org_id', orgId)
      .eq('entity_type', entityType)
      .in('slug', cleaned);
    if (existingErr) throw new InternalServerErrorException(existingErr.message);

    const existingMap = new Map(
      ((existing ?? []) as TagDefinition[]).map((t) => [t.slug, t]),
    );

    // Cria as faltantes
    const missingSlugs = cleaned.filter((s) => !existingMap.has(s));
    if (missingSlugs.length > 0) {
      const rows = missingSlugs.map((slug) => ({
        org_id: orgId,
        entity_type: entityType,
        label: this.humanize(slug),
        slug,
        color: null,
        description: null,
        category: null,
        usage_count: 1,
      }));
      const { data: created, error: createErr } = await this.supabase.adminClient
        .from('tag_definitions')
        .insert(rows)
        .select('*');
      if (createErr) {
        this.logger.warn(
          `upsertMany: insert falhou (não fatal): ${createErr.message}`,
        );
      } else {
        for (const t of (created ?? []) as TagDefinition[]) {
          existingMap.set(t.slug, t);
        }
      }
    }

    // Incrementa usage_count nas existentes (que já estavam antes)
    const incrementSlugs = cleaned.filter(
      (s) => existingMap.has(s) && !missingSlugs.includes(s),
    );
    if (incrementSlugs.length > 0) {
      // Atualização em paralelo (não-atômico). MVP aceitável.
      await Promise.all(
        incrementSlugs.map(async (slug) => {
          const t = existingMap.get(slug)!;
          await this.supabase.adminClient
            .from('tag_definitions')
            .update({ usage_count: t.usage_count + 1 })
            .eq('org_id', orgId)
            .eq('id', t.id);
        }),
      );
    }

    return Array.from(existingMap.values());
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /** "Convênio Gama" → "CONVENIO_GAMA" */
  private slugify(input: string): string {
    return input
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /** "CONVENIO_GAMA" → "Convênio Gama" (best-effort, manda o que dá) */
  private humanize(slug: string): string {
    return slug
      .split('_')
      .filter((p) => p.length > 0)
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join(' ');
  }
}
