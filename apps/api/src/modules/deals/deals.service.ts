import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Deal, DealActivity, Pipeline } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { OutboundWebhookService } from '../webhooks/outbound/outbound-webhook.service';
import { AiService } from '../ai/ai.service';
import { SaasCallbackClient } from '../tasks/saas-callback.client';
import { CreateDealDto } from './dto/create-deal.dto';
import { UpdateDealDto } from './dto/update-deal.dto';
import { MoveDealDto } from './dto/move-deal.dto';
import { ListDealsQueryDto } from './dto/list-deals.query.dto';
import { AddActivityDto } from './dto/add-activity.dto';
import { BoardFiltersDto } from './dto/board-filters.query.dto';
import { AutomationsService } from '../automations/automations.service';

// ──────────────────────────────────────────────────────────
// Tipos do board
// ──────────────────────────────────────────────────────────

/** Linha da view active.v_deal_board (deal ativo + joins). */
export interface BoardDealItem {
  id: string;
  /** Sequencial dentro da org (migration 009). View `v_deal_board` propaga via SELECT *. */
  deal_number: number;
  org_id: string;
  pipeline_id: string;
  stage_id: string;
  title: string;
  value: number;
  currency: string;
  expected_close_date: string | null;
  ai_score: number;
  ai_risk: 'low' | 'medium' | 'high' | 'critical' | null;
  ai_next_action: string | null;
  ai_close_probability: number | null;
  tags: string[];
  position: number;
  stage_entered_at: string;
  created_at: string;
  contact_id: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_avatar: string | null;
  contact_temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  company_id: string | null;
  company_name: string | null;
  stage_name: string;
  stage_color: string;
  stage_position: number;
  stage_probability: number;
  sla_hours: number | null;
  agent_name: string | null;
  agent_avatar: string | null;
  hours_in_stage: number;
  sla_breached: boolean;
}

export interface BoardStageGroup {
  id: string;
  name: string;
  color: string;
  position: number;
  probability: number;
  sla_hours: number | null;
  is_won: boolean;
  is_lost: boolean;
  deals_count: number;
  total_value: number;
  deals: BoardDealItem[];
}

export interface BoardResponse {
  pipeline: { id: string; name: string };
  summary: {
    total_deals: number;
    total_value: number;
    /** Sum of value × stage_probability/100 across active deals */
    weighted_value: number;
  };
  stages: BoardStageGroup[];
}

export interface PaginatedDeals {
  data: Deal[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class DealsService {
  private readonly logger = new Logger(DealsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly ai: AiService,
    private readonly automations: AutomationsService,
    private readonly webhooks: OutboundWebhookService,
    private readonly saasCallback: SaasCallbackClient,
  ) {}

  /**
   * Quando um deal vira "won", fecha as tasks vinculadas pra que:
   *   1. Status visual delas fique consistente (operador não precisa
   *      marcar cada task individualmente)
   *   2. Callback Active→SaaS dispare (saas_cadastro source)
   *
   * Fire-and-forget. Errors logados, nunca bloqueiam o win do deal.
   */
  private async cascadeCompleteTasks(orgId: string, dealId: string, userId?: string | null): Promise<void> {
    try {
      // Busca tasks abertas vinculadas ao deal
      const { data: tasks } = await this.supabase.adminClient
        .from('tasks')
        .select('id, status, metadata')
        .eq('org_id', orgId)
        .eq('deal_id', dealId)
        .neq('status', 'completed');
      const openTasks = (tasks ?? []) as Array<{ id: string; status: string; metadata: Record<string, unknown> | null }>;
      if (openTasks.length === 0) return;

      // Marca todas como completed via UPDATE em batch
      const now = new Date().toISOString();
      const taskIds = openTasks.map(t => t.id);
      await this.supabase.adminClient
        .from('tasks')
        .update({ status: 'completed', completed_at: now })
        .eq('org_id', orgId)
        .in('id', taskIds);

      this.logger.log(`[cascade-complete] deal=${dealId} won → ${openTasks.length} tasks fechadas (user=${userId ?? '?'})`);

      // Dispara callback pro SaaS pra cada task com source='saas_cadastro'
      for (const task of openTasks) {
        const source = task.metadata?.source;
        if (typeof source === 'string') {
          void this.saasCallback.notifyTaskCompleted(task.id, source);
        }
      }
    } catch (e) {
      this.logger.warn(`[cascade-complete] falhou pra deal=${dealId}: ${(e as Error).message}`);
    }
  }

  // ──────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateDealDto): Promise<Deal> {
    // 1. Verifica pipeline + stage pertencem à org (e que stage está no pipeline)
    const stage = await this.assertStageInOrgAndPipeline(
      orgId,
      dto.stage_id,
      dto.pipeline_id,
    );

    // 2. Position = max+1 dentro do stage destino
    const position = await this.nextPositionInStage(dto.stage_id);

    // 3. won_at/lost_at iniciais — se criar JÁ no stage won/lost, refletir
    const won_at = stage.is_won ? new Date().toISOString() : null;
    const lost_at = stage.is_lost ? new Date().toISOString() : null;

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .insert({
        org_id: orgId,
        pipeline_id: dto.pipeline_id,
        stage_id: dto.stage_id,
        contact_id: dto.contact_id ?? null,
        company_id: dto.company_id ?? null,
        conversation_id: dto.conversation_id ?? null,
        title: dto.title,
        value: dto.value ?? 0,
        currency: dto.currency ?? 'BRL',
        expected_close_date: dto.expected_close_date ?? null,
        assigned_to: dto.assigned_to ?? null,
        tags: dto.tags ?? [],
        custom_fields: dto.custom_fields ?? {},
        position,
        won_at,
        lost_at,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create deal');
    }

    const deal = data as Deal;
    this.events.emitToOrg(orgId, 'deal:created', { deal });
    void this.webhooks.deliver(orgId, 'deal.created', deal as unknown as Record<string, unknown>);
    return deal;
  }

  // ──────────────────────────────────────────────────────────
  // FIND ALL — paginado com filtros
  // ──────────────────────────────────────────────────────────

  async findAll(orgId: string, filters: ListDealsQueryDto): Promise<PaginatedDeals> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('deals')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (filters.pipeline_id) q = q.eq('pipeline_id', filters.pipeline_id);
    if (filters.stage_id) q = q.eq('stage_id', filters.stage_id);
    if (filters.assigned_to) q = q.eq('assigned_to', filters.assigned_to);
    if (filters.tags && filters.tags.length > 0) q = q.contains('tags', filters.tags);
    if (filters.min_value !== undefined) q = q.gte('value', filters.min_value);
    if (filters.max_value !== undefined) q = q.lte('value', filters.max_value);

    if (!filters.include_closed) {
      q = q.is('won_at', null).is('lost_at', null);
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as Deal[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY ID — com joins
  // ──────────────────────────────────────────────────────────

  async findById(orgId: string, id: string) {
    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select(
        `
        *,
        contact:contacts(id, name, phone, email, avatar_url, temperature, score, tags),
        company:companies(id, name, domain, industry),
        pipeline:pipelines(id, name),
        stage:pipeline_stages(id, name, color, probability, sla_hours, is_won, is_lost, position)
      `,
      )
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) throw new NotFoundException(`Deal ${id} not found`);
    return data;
  }

  // ──────────────────────────────────────────────────────────
  // GET BOARD — view v_deal_board agrupada por stage
  // ──────────────────────────────────────────────────────────

  async getBoard(
    orgId: string,
    pipelineId: string,
    filters: BoardFiltersDto = {},
  ): Promise<BoardResponse> {
    // 1. Pipeline + nome
    const pipeline = await this.assertPipelineInOrg(orgId, pipelineId);

    // 2. Stages (ordenadas)
    const { data: stagesRaw, error: stagesErr } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, name, color, position, probability, sla_hours, is_won, is_lost')
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true });

    if (stagesErr) throw new InternalServerErrorException(stagesErr.message);
    const stages = (stagesRaw ?? []) as Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      probability: number;
      sla_hours: number | null;
      is_won: boolean;
      is_lost: boolean;
    }>;

    // 3. Deals ativos via view (já tem sla_breached + joins) + filtros
    let dealsQuery = this.supabase.adminClient
      .from('v_deal_board')
      .select('*')
      .eq('org_id', orgId)
      .eq('pipeline_id', pipelineId)
      .order('position', { ascending: true });

    if (filters.assigned_to) {
      dealsQuery = dealsQuery.eq('assigned_to', filters.assigned_to);
    }
    if (filters.tags && filters.tags.length > 0) {
      dealsQuery = dealsQuery.contains('tags', filters.tags);
    }
    if (typeof filters.min_value === 'number') {
      dealsQuery = dealsQuery.gte('value', filters.min_value);
    }
    if (typeof filters.max_value === 'number') {
      dealsQuery = dealsQuery.lte('value', filters.max_value);
    }
    if (filters.risk) {
      dealsQuery = dealsQuery.eq('ai_risk', filters.risk);
    }

    const { data: dealsRaw, error: dealsErr } = await dealsQuery;

    if (dealsErr) throw new InternalServerErrorException(dealsErr.message);
    const deals = (dealsRaw ?? []) as BoardDealItem[];

    // 4. Agrupa por stage_id
    const byStage = new Map<string, BoardDealItem[]>();
    let totalDeals = 0;
    let totalValue = 0;
    let weightedValue = 0;
    for (const d of deals) {
      const list = byStage.get(d.stage_id) ?? [];
      list.push(d);
      byStage.set(d.stage_id, list);
      totalDeals++;
      const v = Number(d.value) || 0;
      totalValue += v;
      weightedValue += (v * (Number(d.stage_probability) || 0)) / 100;
    }

    // 5. Monta resposta
    const stageGroups: BoardStageGroup[] = stages.map((s) => {
      const list = byStage.get(s.id) ?? [];
      const total = list.reduce((sum, d) => sum + (Number(d.value) || 0), 0);
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        position: s.position,
        probability: s.probability,
        sla_hours: s.sla_hours,
        is_won: s.is_won,
        is_lost: s.is_lost,
        deals_count: list.length,
        total_value: round2(total),
        deals: list,
      };
    });

    return {
      pipeline: { id: pipeline.id, name: pipeline.name },
      summary: {
        total_deals: totalDeals,
        total_value: round2(totalValue),
        weighted_value: round2(weightedValue),
      },
      stages: stageGroups,
    };
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateDealDto): Promise<Deal> {
    await this.assertDealInOrg(orgId, id);

    const patch: Record<string, unknown> = {};
    if (dto.title !== undefined) patch.title = dto.title;
    if (dto.value !== undefined) patch.value = dto.value;
    if (dto.currency !== undefined) patch.currency = dto.currency;
    if (dto.expected_close_date !== undefined) patch.expected_close_date = dto.expected_close_date;
    if (dto.assigned_to !== undefined) patch.assigned_to = dto.assigned_to;
    if (dto.tags !== undefined) patch.tags = dto.tags;
    if (dto.custom_fields !== undefined) patch.custom_fields = dto.custom_fields;
    if (dto.conversation_id !== undefined) patch.conversation_id = dto.conversation_id;

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update deal');
    }

    const deal = data as Deal;
    this.events.emitToOrg(orgId, 'deal:updated', { deal });
    void this.webhooks.deliver(orgId, 'deal.updated', deal as unknown as Record<string, unknown>);
    return deal;
  }

  // ──────────────────────────────────────────────────────────
  // DELETE — hard delete
  // ──────────────────────────────────────────────────────────

  async delete(orgId: string, id: string): Promise<void> {
    await this.assertDealInOrg(orgId, id);

    const { error } = await this.supabase.adminClient
      .from('deals')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // MOVE TO STAGE — won/lost detection + position
  // ──────────────────────────────────────────────────────────

  /**
   * Move o deal pra outro stage. Trigger SQL `trg_deal_stage_change` cuida
   * de `stage_entered_at` e logs em `deal_activities` automaticamente.
   * O service só seta `won_at`/`lost_at`/`lost_reason` e a posição.
   */
  async moveToStage(
    orgId: string,
    dealId: string,
    dto: MoveDealDto,
    movedByUserId?: string,
  ): Promise<Deal> {
    const current = await this.assertDealInOrg(orgId, dealId);
    const targetStage = await this.assertStageInOrgAndPipeline(
      orgId,
      dto.stage_id,
      current.pipeline_id,
    );

    // Validação: stage destino is_lost exige lost_reason
    if (targetStage.is_lost && (!dto.lost_reason || dto.lost_reason.trim().length === 0)) {
      throw new BadRequestException(
        'Mover pra stage de Perdido exige lost_reason no body.',
      );
    }

    const fromStageId = current.stage_id;
    const isSameStage = fromStageId === dto.stage_id;

    // Position: se passou, usa; senão coloca no fim do stage destino.
    const position = dto.position ?? (await this.nextPositionInStage(dto.stage_id));

    // Won/Lost timestamps
    const now = new Date().toISOString();
    const patch: Record<string, unknown> = {
      stage_id: dto.stage_id,
      position,
      // Reabertura: se o stage destino é normal e o deal estava fechado, limpa
      won_at: targetStage.is_won ? now : null,
      lost_at: targetStage.is_lost ? now : null,
      lost_reason: targetStage.is_lost ? dto.lost_reason : null,
    };

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', dealId)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`moveToStage failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to move deal');
    }

    const deal = data as Deal;

    // Pega nome do stage destino pra UX dos toasts no frontend
    let toStageName: string | undefined;
    try {
      const { data: stageRow } = await this.supabase.adminClient
        .from('pipeline_stages')
        .select('name')
        .eq('id', deal.stage_id)
        .maybeSingle();
      toStageName = (stageRow as { name?: string } | null)?.name;
    } catch {
      // não-crítico
    }

    this.events.emitToOrg(orgId, 'deal:moved', {
      deal_id: deal.id,
      from_stage_id: fromStageId,
      to_stage_id: deal.stage_id,
      position: deal.position,
      closed_state: targetStage.is_won
        ? 'won'
        : targetStage.is_lost
          ? 'lost'
          : null,
      ...(movedByUserId ? { moved_by_user_id: movedByUserId } : {}),
      deal_title: deal.title,
      ...(toStageName ? { to_stage_name: toStageName } : {}),
    });

    // Webhooks de saída — stage_changed + won/lost específicos quando aplicável
    if (!isSameStage) {
      void this.webhooks.deliver(orgId, 'deal.stage_changed', {
        deal: deal as unknown as Record<string, unknown>,
        from_stage_id: fromStageId,
        to_stage_id: deal.stage_id,
      });
      if (targetStage.is_won) {
        void this.webhooks.deliver(orgId, 'deal.won', deal as unknown as Record<string, unknown>);
        // Cascata: quando deal vira won, fecha as tasks vinculadas automaticamente.
        // Isso aciona o callback Active→SaaS (saas-callback) e fecha o ciclo
        // de cadastro sem o operador precisar marcar cada task manualmente.
        void this.cascadeCompleteTasks(orgId, deal.id, movedByUserId);
      }
      if (targetStage.is_lost) {
        void this.webhooks.deliver(orgId, 'deal.lost', deal as unknown as Record<string, unknown>);
      }
    }

    // Log extra: se mudou de stage, o trigger SQL já gravou um
    // deal_activities row com activity_type='stage_changed'. Não duplicar.
    if (isSameStage) {
      this.logger.debug(`Deal ${dealId} re-positioned within same stage`);
    }

    // Fire-and-forget: re-pontua o deal após mudança de stage. A IA usa
    // o novo contexto (tempo no stage = 0, novo probability) pra recalcular
    // score/risk/close_probability/next_action. Catch interno; não bloqueia
    // o response do move endpoint.
    if (!isSameStage) {
      void this.ai.scoreDeal(orgId, deal.id).catch((err) => {
        this.logger.warn(
          `auto-score após move falhou: ${err instanceof Error ? err.message : String(err)}`,
        );
      });

      // Fire-and-forget: dispara automações de deal_stage_changed
      void this.automations
        .checkTriggers({
          event: 'deal_stage_changed',
          org_id: orgId,
          deal_id: deal.id,
          pipeline_id: deal.pipeline_id,
          from_stage_id: fromStageId,
          to_stage_id: deal.stage_id,
          contact_id: deal.contact_id ?? null,
        })
        .catch((err) => {
          this.logger.warn(
            `automations checkTriggers falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }

    return deal;
  }

  // ──────────────────────────────────────────────────────────
  // REORDER IN STAGE
  // ──────────────────────────────────────────────────────────

  async reorderInStage(
    orgId: string,
    stageId: string,
    dealIds: string[],
  ): Promise<Deal[]> {
    await this.assertStageInOrg(orgId, stageId);

    // Verifica que todos os deals pertencem ao stage e à org
    const { data: existing, error } = await this.supabase.adminClient
      .from('deals')
      .select('id')
      .eq('org_id', orgId)
      .eq('stage_id', stageId);

    if (error) throw new InternalServerErrorException(error.message);
    const validIds = new Set(((existing ?? []) as Array<{ id: string }>).map((r) => r.id));
    const invalid = dealIds.find((id) => !validIds.has(id));
    if (invalid) {
      throw new BadRequestException(
        `Deal ${invalid} não pertence ao stage ${stageId} desta org.`,
      );
    }
    if (dealIds.length !== validIds.size) {
      throw new BadRequestException(
        `deal_ids tem ${dealIds.length} itens mas o stage tem ${validIds.size} deals — passe todos pra reordenar.`,
      );
    }

    // Updates em paralelo. Não-atômico mas janela curta (<100ms).
    await Promise.all(
      dealIds.map((id, idx) =>
        this.supabase.adminClient
          .from('deals')
          .update({ position: idx })
          .eq('org_id', orgId)
          .eq('id', id),
      ),
    );

    const { data: refreshed } = await this.supabase.adminClient
      .from('deals')
      .select('*')
      .eq('org_id', orgId)
      .eq('stage_id', stageId)
      .order('position', { ascending: true });

    return (refreshed ?? []) as Deal[];
  }

  // ──────────────────────────────────────────────────────────
  // GET DEAL ACTIVITIES — timeline do deal
  // ──────────────────────────────────────────────────────────

  async getDealActivities(orgId: string, dealId: string): Promise<DealActivity[]> {
    await this.assertDealInOrg(orgId, dealId);

    const { data, error } = await this.supabase.adminClient
      .from('deal_activities')
      .select('*')
      .eq('org_id', orgId)
      .eq('deal_id', dealId)
      .order('created_at', { ascending: false });

    if (error) {
      this.logger.error(`getDealActivities failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as DealActivity[];
  }

  // ──────────────────────────────────────────────────────────
  // ADD ACTIVITY — registro manual (nota, email, ligação, etc.)
  // ──────────────────────────────────────────────────────────

  /**
   * Insere uma atividade na timeline do deal. Restringido a tipos "user-
   * creatable" no DTO — `stage_changed` e `value_changed` continuam sendo
   * gerados automaticamente por triggers SQL.
   */
  async addActivity(
    orgId: string,
    dealId: string,
    userId: string,
    dto: AddActivityDto,
  ): Promise<DealActivity> {
    await this.assertDealInOrg(orgId, dealId);

    const { data, error } = await this.supabase.adminClient
      .from('deal_activities')
      .insert({
        org_id: orgId,
        deal_id: dealId,
        activity_type: dto.activity_type,
        title: dto.title ?? null,
        description: dto.description,
        metadata: dto.metadata ?? {},
        created_by: userId,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`addActivity failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to add activity');
    }

    const activity = data as DealActivity;
    this.events.emitToOrg(orgId, 'deal:activity_added', { deal_id: dealId, activity });
    return activity;
  }

  // ──────────────────────────────────────────────────────────
  // helpers / asserts
  // ──────────────────────────────────────────────────────────

  private async assertDealInOrg(orgId: string, dealId: string): Promise<Deal> {
    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', dealId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Deal ${dealId} not found`);
    return data as Deal;
  }

  private async assertPipelineInOrg(orgId: string, pipelineId: string): Promise<Pipeline> {
    const { data, error } = await this.supabase.adminClient
      .from('pipelines')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', pipelineId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Pipeline ${pipelineId} not found`);
    return data as Pipeline;
  }

  /**
   * Verifica que o stage pertence à org (via parent pipeline). Retorna
   * dados úteis pra decisões de move (is_won, is_lost, pipeline_id).
   */
  private async assertStageInOrg(
    orgId: string,
    stageId: string,
  ): Promise<{ id: string; pipeline_id: string; is_won: boolean; is_lost: boolean }> {
    const { data, error } = await this.supabase.adminClient
      .from('pipeline_stages')
      .select('id, pipeline_id, is_won, is_lost, pipeline:pipelines!inner(org_id)')
      .eq('id', stageId)
      .eq('pipeline.org_id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Stage ${stageId} not found`);
    return {
      id: data.id as string,
      pipeline_id: data.pipeline_id as string,
      is_won: data.is_won as boolean,
      is_lost: data.is_lost as boolean,
    };
  }

  /**
   * Variante que também checa que o stage pertence ao pipeline informado.
   * Importante pra create — o frontend pode passar combinação inválida.
   */
  private async assertStageInOrgAndPipeline(
    orgId: string,
    stageId: string,
    pipelineId: string,
  ): Promise<{ id: string; is_won: boolean; is_lost: boolean }> {
    const stage = await this.assertStageInOrg(orgId, stageId);
    if (stage.pipeline_id !== pipelineId) {
      throw new ConflictException(
        `Stage ${stageId} não pertence ao pipeline ${pipelineId}.`,
      );
    }
    return stage;
  }

  private async nextPositionInStage(stageId: string): Promise<number> {
    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select('position')
      .eq('stage_id', stageId)
      .order('position', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return ((data?.position as number) ?? -1) + 1;
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
