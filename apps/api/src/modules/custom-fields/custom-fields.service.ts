import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
  OrgMemberRole,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateCustomFieldDto,
  CreateGroupDto,
  CUSTOM_FIELD_TYPES_REQUIRING_OPTIONS,
  ReorderDefinitionsDto,
  ReorderGroupsDto,
  UpdateCustomFieldDto,
  UpdateGroupDto,
} from './dto/custom-field.dto';

@Injectable()
export class CustomFieldsService {
  private readonly logger = new Logger(CustomFieldsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ────────────────────────────────────────────
  // DEFINITIONS — CRUD
  // ────────────────────────────────────────────

  /**
   * Lista todas as definitions da org, ordenadas pelo position do
   * grupo (asc) e depois pelo position do campo (asc). Campos sem
   * grupo (`group_id IS NULL`) vão pro final.
   */
  async getDefinitions(
    orgId: string,
    entityType?: CustomFieldEntityType,
  ): Promise<CustomFieldDefinition[]> {
    let q = this.supabase.adminClient
      .from('custom_field_definitions')
      .select('*')
      .eq('org_id', orgId)
      .order('position', { ascending: true });

    if (entityType) q = q.eq('entity_type', entityType);

    const { data, error } = await q;
    if (error) {
      this.logger.error(`getDefinitions failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as CustomFieldDefinition[];
  }

  async createDefinition(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: CreateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem criar campos personalizados.');
    }

    // Validação: select/multi_select/radio exigem options não-vazias
    if (
      CUSTOM_FIELD_TYPES_REQUIRING_OPTIONS.includes(dto.field_type) &&
      (!dto.options || dto.options.length === 0)
    ) {
      throw new BadRequestException(
        `field_type "${dto.field_type}" exige options não-vazias.`,
      );
    }

    // Se group_id passado, valida que pertence à mesma org+entity_type
    if (dto.group_id) {
      await this.assertGroupInOrg(orgId, dto.group_id, dto.entity_type);
    }

    const { data, error } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .insert({
        org_id: orgId,
        entity_type: dto.entity_type,
        group_id: dto.group_id ?? null,
        name: dto.name.trim(),
        field_type: dto.field_type,
        options: dto.options ?? [],
        is_required: dto.is_required ?? false,
        is_api_only: dto.is_api_only ?? false,
        position: dto.position ?? 0,
        ai_auto_fill: dto.ai_auto_fill ?? true,
        task_trigger: dto.task_trigger ?? null,
        placeholder: dto.placeholder ?? null,
      })
      .select('*')
      .single();

    if (error || !data) {
      if (error?.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException(
          `Já existe um campo com o nome "${dto.name}" para ${dto.entity_type}.`,
        );
      }
      this.logger.error(`createDefinition failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create custom field');
    }
    return data as CustomFieldDefinition;
  }

  async updateDefinition(
    orgId: string,
    actorRole: OrgMemberRole,
    id: string,
    dto: UpdateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem editar campos personalizados.');
    }

    // Pega o existente pra validações cruzadas
    const existing = await this.assertDefinitionInOrg(orgId, id);

    // Se mudando group_id, valida pertence à mesma entity_type da org
    if (dto.group_id) {
      await this.assertGroupInOrg(orgId, dto.group_id, existing.entity_type);
    }

    // Se mudando field_type pra um que exige options, valida
    if (
      dto.field_type &&
      CUSTOM_FIELD_TYPES_REQUIRING_OPTIONS.includes(dto.field_type)
    ) {
      const newOptions = dto.options ?? existing.options;
      if (!newOptions || newOptions.length === 0) {
        throw new BadRequestException(
          `field_type "${dto.field_type}" exige options não-vazias.`,
        );
      }
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.field_type !== undefined) patch.field_type = dto.field_type;
    if (dto.options !== undefined) patch.options = dto.options;
    if (dto.is_required !== undefined) patch.is_required = dto.is_required;
    if (dto.is_api_only !== undefined) patch.is_api_only = dto.is_api_only;
    if (dto.position !== undefined) patch.position = dto.position;
    if (dto.group_id !== undefined) patch.group_id = dto.group_id;
    if (dto.ai_auto_fill !== undefined) patch.ai_auto_fill = dto.ai_auto_fill;
    if (dto.task_trigger !== undefined) patch.task_trigger = dto.task_trigger;
    if (dto.placeholder !== undefined) patch.placeholder = dto.placeholder;

    const { data, error } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      if (error?.message.toLowerCase().includes('duplicate')) {
        throw new ConflictException('Outro campo já tem esse nome nessa entidade.');
      }
      this.logger.error(`updateDefinition failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update');
    }
    return data as CustomFieldDefinition;
  }

  /**
   * Apaga a definition. Os valores em `entity.custom_fields[name]` ficam
   * "órfãos" no jsonb dos registros existentes — não tem efeito no read
   * (o renderer só renderiza pelas defs, ignora chaves desconhecidas), mas
   * o agente perde acesso à edição. Não auto-purgamos pra preservar dados.
   */
  async deleteDefinition(
    orgId: string,
    actorRole: OrgMemberRole,
    id: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem deletar campos personalizados.');
    }

    const { error } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`deleteDefinition failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  /**
   * Reordena campos da entidade. Usa Promise.all (não atômico em alta
   * concorrência mas adequado pro volume; corrida só causa flicker visual).
   */
  async reorderDefinitions(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: ReorderDefinitionsDto,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem reordenar campos.');
    }

    // Valida que todos os ids são da org+entity_type
    const { data, error } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .select('id')
      .eq('org_id', orgId)
      .eq('entity_type', dto.entity_type)
      .in('id', dto.field_ids);

    if (error) throw new InternalServerErrorException(error.message);
    const validIds = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    const invalid = dto.field_ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new BadRequestException(
        `Campo ${invalid} não pertence à entidade ${dto.entity_type} desta org.`,
      );
    }

    await Promise.all(
      dto.field_ids.map((id, idx) =>
        this.supabase.adminClient
          .from('custom_field_definitions')
          .update({ position: idx })
          .eq('org_id', orgId)
          .eq('id', id),
      ),
    );
  }

  // ────────────────────────────────────────────
  // GROUPS — CRUD
  // ────────────────────────────────────────────

  async getGroups(
    orgId: string,
    entityType?: CustomFieldEntityType,
  ): Promise<CustomFieldGroup[]> {
    let q = this.supabase.adminClient
      .from('custom_field_groups')
      .select('*')
      .eq('org_id', orgId)
      .order('position', { ascending: true });

    if (entityType) q = q.eq('entity_type', entityType);

    const { data, error } = await q;
    if (error) {
      this.logger.error(`getGroups failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as CustomFieldGroup[];
  }

  async createGroup(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: CreateGroupDto,
  ): Promise<CustomFieldGroup> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem criar grupos.');
    }

    const { data, error } = await this.supabase.adminClient
      .from('custom_field_groups')
      .insert({
        org_id: orgId,
        entity_type: dto.entity_type,
        name: dto.name.trim(),
        icon: dto.icon ?? null,
        position: dto.position ?? 0,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`createGroup failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create group');
    }
    return data as CustomFieldGroup;
  }

  async updateGroup(
    orgId: string,
    actorRole: OrgMemberRole,
    id: string,
    dto: UpdateGroupDto,
  ): Promise<CustomFieldGroup> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem editar grupos.');
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.icon !== undefined) patch.icon = dto.icon;
    if (dto.position !== undefined) patch.position = dto.position;

    const { data, error } = await this.supabase.adminClient
      .from('custom_field_groups')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`updateGroup failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update group');
    }
    return data as CustomFieldGroup;
  }

  /**
   * Apaga grupo. ON DELETE SET NULL no FK faz com que campos do grupo
   * voltem pra "Sem grupo" (group_id=null) automaticamente.
   */
  async deleteGroup(
    orgId: string,
    actorRole: OrgMemberRole,
    id: string,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem deletar grupos.');
    }

    const { error } = await this.supabase.adminClient
      .from('custom_field_groups')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`deleteGroup failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  async reorderGroups(
    orgId: string,
    actorRole: OrgMemberRole,
    dto: ReorderGroupsDto,
  ): Promise<void> {
    if (!['owner', 'admin'].includes(actorRole)) {
      throw new ForbiddenException('Apenas owner/admin podem reordenar grupos.');
    }

    const { data, error } = await this.supabase.adminClient
      .from('custom_field_groups')
      .select('id')
      .eq('org_id', orgId)
      .eq('entity_type', dto.entity_type)
      .in('id', dto.group_ids);

    if (error) throw new InternalServerErrorException(error.message);
    const validIds = new Set(((data ?? []) as Array<{ id: string }>).map((r) => r.id));
    const invalid = dto.group_ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new BadRequestException(
        `Grupo ${invalid} não pertence à entidade ${dto.entity_type} desta org.`,
      );
    }

    await Promise.all(
      dto.group_ids.map((id, idx) =>
        this.supabase.adminClient
          .from('custom_field_groups')
          .update({ position: idx })
          .eq('org_id', orgId)
          .eq('id', id),
      ),
    );
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  private async assertGroupInOrg(
    orgId: string,
    groupId: string,
    entityType: CustomFieldEntityType,
  ): Promise<void> {
    const { data, error } = await this.supabase.adminClient
      .from('custom_field_groups')
      .select('id, entity_type')
      .eq('org_id', orgId)
      .eq('id', groupId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) {
      throw new NotFoundException(`Grupo ${groupId} não encontrado nessa org.`);
    }
    if ((data as { entity_type: string }).entity_type !== entityType) {
      throw new BadRequestException(
        `Grupo ${groupId} pertence à entidade "${(data as { entity_type: string }).entity_type}", não "${entityType}".`,
      );
    }
  }

  private async assertDefinitionInOrg(
    orgId: string,
    id: string,
  ): Promise<CustomFieldDefinition> {
    const { data, error } = await this.supabase.adminClient
      .from('custom_field_definitions')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Custom field ${id} não encontrado.`);
    return data as CustomFieldDefinition;
  }
}
