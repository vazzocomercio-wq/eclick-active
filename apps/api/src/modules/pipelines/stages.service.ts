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
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.color !== undefined) patch.color = dto.color;
    if (dto.probability !== undefined) patch.probability = dto.probability;
    if (dto.sla_hours !== undefined) patch.sla_hours = dto.sla_hours; // null permitido
    if (dto.automation_rules !== undefined) patch.automation_rules = dto.automation_rules;
    if (dto.required_contact_fields !== undefined)
      patch.required_contact_fields = dto.required_contact_fields;
    if (dto.required_deal_fields !== undefined)
      patch.required_deal_fields = dto.required_deal_fields;

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
   * Aplica nova ordem nos stages de um pipeline.
   *
   * Validações:
   *  - O array deve conter EXATAMENTE os stages do pipeline (sem extras / sem faltas)
   *
   * Auto-normalize: stages won/lost são SEMPRE empurrados pro final,
   * preservando a ordem dos normais como veio na request. Em vez de
   * rejeitar quando um normal vem depois de won/lost, organiza.
   *
   * Why: createStage cria a stage com position = max+1 (= depois de
   * Ganho/Perdido). O frontend tenta consertar via reorderStages, e
   * antes da auto-normalize a request era rejeitada por violação. Pior:
   * se o estado já tinha um normal após won/lost (legacy), TODA tentativa
   * de drag-drop subsequente também era rejeitada — deadlock.
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

    // Auto-normalize: separa normais e terminais, terminais SEMPRE pro fim
    const normais: string[] = [];
    const terminais: string[] = [];
    for (const id of stageIds) {
      const s = stageMap.get(id)!;
      if (s.is_won || s.is_lost) {
        terminais.push(id);
      } else {
        normais.push(id);
      }
    }
    const finalOrder = [...normais, ...terminais];

    // Aplica as novas positions em paralelo
    await Promise.all(
      finalOrder.map((id, idx) =>
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
