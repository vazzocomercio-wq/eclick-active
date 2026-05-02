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
import {
  PIPELINE_TEMPLATES,
  TEMPLATE_CLOSING_STAGES,
  type PipelineTemplateKey,
} from './pipeline-templates';

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

  async findAll(
    orgId: string,
    options: { includeArchived?: boolean } = {},
  ): Promise<PipelineWithStages[]> {
    let q = this.supabase.adminClient
      .from('pipelines')
      .select('*, pipeline_stages(*)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: true })
      .order('position', { foreignTable: 'pipeline_stages', ascending: true });

    // Por padrão, esconde pipelines arquivados — board e selector usam essa
    // chamada e não devem mostrar arquivados. /funis/configuracoes passa
    // includeArchived=true pra exibir e oferecer "Restaurar".
    if (!options.includeArchived) {
      q = q.is('archived_at', null);
    }

    const { data: pipelines, error } = await q;

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
  // CREATE FROM TEMPLATE — bootstrap rápido por segmento
  // ──────────────────────────────────────────────────────────

  /**
   * Cria pipeline + todos os stages a partir de um template predefinido em
   * `pipeline-templates.ts`. Adiciona automaticamente os stages "Ganho" e
   * "Perdido" no final.
   */
  async createFromTemplate(
    orgId: string,
    templateKey: PipelineTemplateKey,
    customName?: string,
  ): Promise<PipelineWithStages> {
    const template = PIPELINE_TEMPLATES[templateKey];
    if (!template) {
      throw new NotFoundException(`Template "${templateKey}" não encontrado.`);
    }

    // Cria o pipeline (não-default por enquanto — user marca depois se quiser)
    const { data: pipelineRow, error: pipelineErr } = await this.supabase.adminClient
      .from('pipelines')
      .insert({
        org_id: orgId,
        name: customName?.trim() || template.default_name,
        is_default: false,
        settings: { template_key: templateKey },
      })
      .select('*')
      .single();

    if (pipelineErr || !pipelineRow) {
      this.logger.error(`createFromTemplate failed: ${pipelineErr?.message}`);
      throw new InternalServerErrorException(
        pipelineErr?.message ?? 'Failed to create pipeline from template',
      );
    }

    // Cria stages — template.stages + closing stages no final
    const allStages = [...template.stages, ...TEMPLATE_CLOSING_STAGES];
    const stageRows = allStages.map((s, idx) => ({
      pipeline_id: pipelineRow.id as string,
      name: s.name,
      position: idx,
      color: s.color,
      probability: s.probability,
      is_won: 'is_won' in s ? !!s.is_won : false,
      is_lost: 'is_lost' in s ? !!s.is_lost : false,
    }));

    const { error: stagesErr } = await this.supabase.adminClient
      .from('pipeline_stages')
      .insert(stageRows);

    if (stagesErr) {
      // Rollback do pipeline pra não deixar lixo
      await this.supabase.adminClient
        .from('pipelines')
        .delete()
        .eq('id', pipelineRow.id);
      this.logger.error(`createFromTemplate stages insert failed: ${stagesErr.message}`);
      throw new InternalServerErrorException(stagesErr.message);
    }

    return this.findById(orgId, pipelineRow.id as string);
  }

  // ──────────────────────────────────────────────────────────
  // ARCHIVE / RESTORE
  // ──────────────────────────────────────────────────────────

  async archive(orgId: string, id: string): Promise<Pipeline> {
    await this.assertExists(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .update({ archived_at: new Date().toISOString(), is_default: false })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Failed to archive');
    }
    return data as Pipeline;
  }

  async restore(orgId: string, id: string): Promise<Pipeline> {
    await this.assertExists(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .update({ archived_at: null })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Failed to restore');
    }
    return data as Pipeline;
  }

  // ──────────────────────────────────────────────────────────
  // DELETE STAGE WITH MOVE — bulk-move deals + delete stage
  // ──────────────────────────────────────────────────────────

  /**
   * Move todos os deals do stage origem para o stage destino e em seguida
   * apaga o stage origem. Usado pelo dialog "Esta etapa tem N deals — pra
   * onde mover?" em /funis/configuracoes.
   *
   * O stage destino precisa pertencer ao mesmo pipeline. Se o destino for
   * is_lost, exigir lost_reason ainda não é forçado aqui (deal.lost_reason
   * fica null) — refinement futuro pode pedir o motivo no dialog.
   */
  async deleteStageAndMoveDeals(
    orgId: string,
    pipelineId: string,
    sourceStageId: string,
    targetStageId: string,
  ): Promise<{ moved: number }> {
    await this.assertExists(orgId, pipelineId);

    if (sourceStageId === targetStageId) {
      throw new ConflictException('Stage origem e destino são iguais.');
    }

    // Valida que ambas as stages existem no pipeline
    const { data: stages, error: stagesErr } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, pipeline_id, is_won, is_lost')
      .eq('pipeline_id', pipelineId)
      .in('id', [sourceStageId, targetStageId]);

    if (stagesErr) throw new InternalServerErrorException(stagesErr.message);
    const stageIds = new Set(((stages ?? []) as Array<{ id: string }>).map((s) => s.id));
    if (!stageIds.has(sourceStageId) || !stageIds.has(targetStageId)) {
      throw new NotFoundException('Stage origem ou destino não pertence a este pipeline.');
    }

    const targetMeta =
      ((stages ?? []) as Array<{ id: string; is_won: boolean; is_lost: boolean }>).find(
        (s) => s.id === targetStageId,
      );

    // Pega timestamps de fechamento se o destino for terminal
    const now = new Date().toISOString();
    const closurePatch: Record<string, unknown> = { stage_id: targetStageId };
    if (targetMeta?.is_won) closurePatch.won_at = now;
    if (targetMeta?.is_lost) closurePatch.lost_at = now;

    // Bulk move dos deals ATIVOS no stage origem
    const { data: movedRows, error: moveErr } = await this.supabase.adminClient
      .from('deals')
      .update(closurePatch)
      .eq('org_id', orgId)
      .eq('pipeline_id', pipelineId)
      .eq('stage_id', sourceStageId)
      .select('id');

    if (moveErr) throw new InternalServerErrorException(moveErr.message);
    const moved = (movedRows ?? []).length;

    // Apaga o stage agora que está vazio
    const { error: deleteErr } = await this.supabase.adminClient
      .from('pipeline_stages')
      .delete()
      .eq('pipeline_id', pipelineId)
      .eq('id', sourceStageId);

    if (deleteErr) {
      this.logger.error(`deleteStageAndMoveDeals stage delete failed: ${deleteErr.message}`);
      throw new InternalServerErrorException(deleteErr.message);
    }

    return { moved };
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
