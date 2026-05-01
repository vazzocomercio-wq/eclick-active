import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { PipelineStage } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { PipelinesService } from './pipelines.service';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';

const DEFAULT_STAGE_COLOR = '#00E5FF';

@Injectable()
export class StagesService {
  private readonly logger = new Logger(StagesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pipelines: PipelinesService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CREATE — position = max(position) + 1
  // ──────────────────────────────────────────────────────────

  async createStage(
    orgId: string,
    pipelineId: string,
    dto: CreateStageDto,
  ): Promise<PipelineStage> {
    await this.pipelines.assertExists(orgId, pipelineId);

    // Calcula position. Race condition possível com 2 creates concorrentes
    // — aceitável; o pior caso é dois stages com mesma position e a UI
    // pode reorder depois.
    const position = await this.nextPosition(pipelineId);

    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .insert({
        pipeline_id: pipelineId,
        name: dto.name,
        color: dto.color ?? DEFAULT_STAGE_COLOR,
        probability: dto.probability ?? 0,
        sla_hours: dto.sla_hours ?? null,
        automation_rules: dto.automation_rules ?? [],
        position,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`createStage failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create stage');
    }
    return data as PipelineStage;
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────

  async updateStage(
    orgId: string,
    stageId: string,
    dto: UpdateStageDto,
  ): Promise<PipelineStage> {
    // assertOwnership já verifica que o pipeline parent pertence à org
    await this.assertOwnership(orgId, stageId);

    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.probability !== undefined) patch.probability = dto.probability;
    if (dto.sla_hours !== undefined) patch.sla_hours = dto.sla_hours; // null permitido
    if (dto.automation_rules !== undefined) patch.automation_rules = dto.automation_rules;

    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .update(patch)
      .eq('id', stageId)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`updateStage failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update stage');
    }
    return data as PipelineStage;
  }

  // ──────────────────────────────────────────────────────────
  // DELETE — bloqueia won/lost e qualquer deal vinculado
  // ──────────────────────────────────────────────────────────

  async deleteStage(orgId: string, stageId: string): Promise<void> {
    const stage = await this.assertOwnership(orgId, stageId);

    if (stage.is_won || stage.is_lost) {
      throw new ConflictException('Stages "Ganho" e "Perdido" não podem ser deletadas.');
    }

    const { count, error: countErr } = await this.supabase.adminClient
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId)
      .eq('stage_id', stageId);

    if (countErr) throw new InternalServerErrorException(countErr.message);
    if ((count ?? 0) > 0) {
      throw new ConflictException(
        `Stage tem ${count} deal(s). Mova-os pra outra etapa antes de deletar.`,
      );
    }

    const { error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .delete()
      .eq('id', stageId);

    if (error) {
      this.logger.error(`deleteStage failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // REORDER — recebe a nova ordem dos IDs
  // ──────────────────────────────────────────────────────────

  /**
   * Aplica nova ordem nos stages de um pipeline. Validações:
   *  - O array deve conter EXATAMENTE os stages do pipeline (sem extras / sem faltas)
   *  - Stages won/lost devem permanecer ao FINAL — não pode haver normal depois deles
   *
   * Updates rodam em paralelo (não-atômico). Janela de inconsistência <100ms;
   * pra produção alta, migrar pra RPC com BEGIN/COMMIT.
   */
  async reorderStages(
    orgId: string,
    pipelineId: string,
    stageIds: string[],
  ): Promise<PipelineStage[]> {
    await this.pipelines.assertExists(orgId, pipelineId);

    const { data: existing, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', pipelineId);

    if (error) throw new InternalServerErrorException(error.message);

    const stages = (existing ?? []) as PipelineStage[];
    const stageMap = new Map(stages.map((s) => [s.id, s]));

    if (stageIds.length !== stages.length) {
      throw new BadRequestException(
        `stage_ids tem ${stageIds.length} itens mas o pipeline tem ${stages.length} stages.`,
      );
    }
    const missing = stageIds.find((id) => !stageMap.has(id));
    if (missing) {
      throw new BadRequestException(`Stage ${missing} não pertence ao pipeline ${pipelineId}.`);
    }

    // Won/Lost devem ficar ao final. Pega o índice do último normal e do
    // primeiro won/lost — se um normal vem DEPOIS de won/lost, recusa.
    let firstWonLostIdx = stageIds.length;
    let lastNormalIdx = -1;
    stageIds.forEach((id, idx) => {
      const s = stageMap.get(id)!;
      if (s.is_won || s.is_lost) {
        if (idx < firstWonLostIdx) firstWonLostIdx = idx;
      } else {
        if (idx > lastNormalIdx) lastNormalIdx = idx;
      }
    });
    if (lastNormalIdx > firstWonLostIdx) {
      throw new ConflictException(
        'Stages "Ganho" e "Perdido" precisam ficar no final do funil.',
      );
    }

    // Aplica as novas positions em paralelo
    await Promise.all(
      stageIds.map((id, idx) =>
        this.supabase.adminClient
          .from('pipeline_stages')
          .update({ position: idx })
          .eq('id', id),
      ),
    );

    // Re-fetch ordenado
    const { data: refreshed } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('*')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true });

    return (refreshed ?? []) as PipelineStage[];
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  private async nextPosition(pipelineId: string): Promise<number> {
    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('position')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    return ((data?.position as number) ?? -1) + 1;
  }

  /**
   * Carrega o stage e verifica que o pipeline parent pertence à org. Como
   * `pipeline_stages` não tem `org_id` direto, usamos `!inner` join filtrando
   * o pipeline pela org.
   */
  private async assertOwnership(orgId: string, stageId: string): Promise<PipelineStage> {
    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('*, pipeline:pipelines!inner(org_id)')
      .eq('id', stageId)
      .eq('pipeline.org_id', orgId)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Stage ${stageId} not found`);

    // Strip o join — não retornamos `pipeline` pro caller
    const { pipeline: _ignored, ...stage } = data as PipelineStage & {
      pipeline: { org_id: string };
    };
    return stage as PipelineStage;
  }
}
