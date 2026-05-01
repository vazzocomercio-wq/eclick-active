import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Pipeline, PipelineStage } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';

export interface PipelineStageWithCount extends PipelineStage {
  /** Contagem de deals ativos (won_at IS NULL AND lost_at IS NULL). */
  deal_count: number;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStageWithCount[];
}

@Injectable()
export class PipelinesService {
  private readonly logger = new Logger(PipelinesService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // CREATE — desmarca default anterior se necessário
  // ──────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreatePipelineDto): Promise<Pipeline> {
    if (dto.is_default) {
      await this.unsetDefaultElsewhere(orgId);
    }

    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .insert({
        org_id: orgId,
        name: dto.name,
        is_default: dto.is_default ?? false,
        settings: dto.settings ?? {},
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create pipeline');
    }
    return data as Pipeline;
  }

  // ──────────────────────────────────────────────────────────
  // FIND ALL — pipelines com stages e contagem por stage
  // ──────────────────────────────────────────────────────────

  async findAll(orgId: string): Promise<PipelineWithStages[]> {
    const { data: pipelines, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('*, pipeline_stages(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .order('position', { foreignTable: 'pipeline_stages', ascending: true });

    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (pipelines ?? []) as Array<Pipeline & { pipeline_stages: PipelineStage[] }>;
    if (rows.length === 0) return [];

    const allStageIds = rows.flatMap((p) => (p.pipeline_stages ?? []).map((s) => s.id));
    const counts = await this.fetchActiveDealCountsByStage(orgId, allStageIds);

    return rows.map((p) => ({
      ...p,
      stages: (p.pipeline_stages ?? []).map((s) => ({
        ...s,
        deal_count: counts.get(s.id) ?? 0,
      })),
    }));
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY ID — pipeline + stages ordenados
  // ──────────────────────────────────────────────────────────

  async findById(orgId: string, id: string): Promise<PipelineWithStages> {
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('*, pipeline_stages(*)')
      .eq('org_id', orgId)
      .eq('id', id)
      .order('position', { foreignTable: 'pipeline_stages', ascending: true })
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) throw new NotFoundException(`Pipeline ${id} not found`);

    const row = data as Pipeline & { pipeline_stages: PipelineStage[] };
    const stageIds = (row.pipeline_stages ?? []).map((s) => s.id);
    const counts = await this.fetchActiveDealCountsByStage(orgId, stageIds);

    return {
      ...row,
      stages: (row.pipeline_stages ?? []).map((s) => ({
        ...s,
        deal_count: counts.get(s.id) ?? 0,
      })),
    };
  }

  // ──────────────────────────────────────────────────────────
  // GET DEFAULT
  // ──────────────────────────────────────────────────────────

  async getDefault(orgId: string): Promise<Pipeline | null> {
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('*')
      .eq('org_id', orgId)
      .eq('is_default', true)
      .maybeSingle();

    if (error) {
      this.logger.error(`getDefault failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data as Pipeline | null) ?? null;
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdatePipelineDto): Promise<Pipeline> {
    await this.assertExists(orgId, id);

    if (dto.is_default === true) {
      await this.unsetDefaultElsewhere(orgId, id);
    }

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.is_default !== undefined) patch.is_default = dto.is_default;
    if (dto.settings !== undefined) patch.settings = dto.settings;

    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update pipeline');
    }
    return data as Pipeline;
  }

  // ──────────────────────────────────────────────────────────
  // DELETE — bloqueia se houver deals ATIVOS
  // ──────────────────────────────────────────────────────────

  /**
   * **Atenção**: a FK de `deals.pipeline_id` é ON DELETE CASCADE — deals
   * fechados (won/lost) também serão apagados junto com o pipeline. Pra
   * preservar histórico de fechados, mude pra ON DELETE SET NULL via
   * migration futura, OU use bloqueio total (qualquer deal, não só ativo).
   */
  async delete(orgId: string, id: string): Promise<void> {
    await this.assertExists(orgId, id);

    const { count, error: countErr } = await this.supabase.adminClient
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('pipeline_id', id)
      .is('won_at', null)
      .is('lost_at', null);

    if (countErr) {
      throw new InternalServerErrorException(countErr.message);
    }
    if ((count ?? 0) > 0) {
      throw new ConflictException(
        `Pipeline tem ${count} deal(s) ativo(s). Mova ou feche-os antes de deletar.`,
      );
    }

    const { error } = await this.supabase.adminClient
      .from('pipelines')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // helpers internos
  // ──────────────────────────────────────────────────────────

  /** Garante que o pipeline existe e pertence à org. Throws 404 senão. */
  async assertExists(orgId: string, id: string): Promise<Pipeline> {
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Pipeline ${id} not found`);
    return data as Pipeline;
  }

  /**
   * Desmarca is_default em qualquer outro pipeline da org. Quando `excludeId`
   * é passado, não toca no pipeline com esse id (caso do update).
   */
  private async unsetDefaultElsewhere(orgId: string, excludeId?: string): Promise<void> {
    let q = this.supabase.adminClient
      .from('pipelines')
      .update({ is_default: false })
      .eq('org_id', orgId)
      .eq('is_default', true);
    if (excludeId) q = q.neq('id', excludeId);
    const { error } = await q;
    if (error) {
      this.logger.warn(`unset previous default failed: ${error.message}`);
    }
  }

  /**
   * Conta deals ATIVOS (won_at IS NULL AND lost_at IS NULL) agrupados por
   * stage_id. Volume típico (<5K deals/org) cabe num único select; em
   * organizações maiores, migrar pra view materializada ou RPC.
   */
  private async fetchActiveDealCountsByStage(
    orgId: string,
    stageIds: string[],
  ): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (stageIds.length === 0) return out;

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select('stage_id')
      .eq('org_id', orgId)
      .is('won_at', null)
      .is('lost_at', null)
      .in('stage_id', stageIds);

    if (error) {
      this.logger.warn(`deal count query failed: ${error.message}`);
      return out;
    }

    for (const row of (data ?? []) as Array<{ stage_id: string }>) {
      out.set(row.stage_id, (out.get(row.stage_id) ?? 0) + 1);
    }
    return out;
  }
}
