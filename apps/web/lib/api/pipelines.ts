import type { DealRisk, Pipeline, PipelineStage } from '@eclick-active/shared';
import { api } from './client';

export interface PipelineStageWithCount extends PipelineStage {
  deal_count: number;
}

export interface PipelineWithStages extends Pipeline {
  stages: PipelineStageWithCount[];
}

/** Shape de cada deal no board (vem da view active.v_deal_board). */
export interface BoardDealItem {
  id: string;
  /** Número sequencial dentro da org (migration 009). */
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
    weighted_value: number;
  };
  stages: BoardStageGroup[];
}

export interface BoardFilters {
  assigned_to?: string;
  tags?: string[];
  min_value?: number;
  max_value?: number;
  risk?: DealRisk;
}

export interface CreatePipelineInput {
  name: string;
  is_default?: boolean;
}

export interface UpdatePipelineInput {
  name?: string;
  is_default?: boolean;
}

export interface CreateStageInput {
  name: string;
  color?: string;
  probability?: number;
  sla_hours?: number;
}

export interface UpdateStageInput {
  name?: string;
  color?: string;
  probability?: number;
  sla_hours?: number | null;
}

function filtersToQuery(f: BoardFilters): Record<string, string | number | string[] | undefined> {
  return {
    assigned_to: f.assigned_to,
    tags: f.tags && f.tags.length > 0 ? f.tags : undefined,
    min_value: f.min_value,
    max_value: f.max_value,
    risk: f.risk,
  };
}

export type PipelineTemplateKey =
  | 'ecommerce'
  | 'clinica'
  | 'imobiliaria'
  | 'educacao'
  | 'servicos_b2b'
  | 'energia_solar';

export interface PipelineTemplateMeta {
  key: PipelineTemplateKey;
  default_name: string;
  description: string;
  icon: string;
  stages: Array<{ name: string; color: string; probability: number }>;
}

export const pipelinesApi = {
  list(
    options: { includeArchived?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<PipelineWithStages[]> {
    return api.get<PipelineWithStages[]>('/pipelines', {
      query: options.includeArchived ? { include_archived: 'true' } : {},
      signal,
    });
  },
  listTemplates(signal?: AbortSignal): Promise<PipelineTemplateMeta[]> {
    return api.get<PipelineTemplateMeta[]>('/pipelines/templates', { signal });
  },
  createFromTemplate(
    template: PipelineTemplateKey,
    name?: string,
  ): Promise<PipelineWithStages> {
    return api.post<PipelineWithStages>('/pipelines/from-template', {
      template,
      ...(name ? { name } : {}),
    });
  },
  archive(id: string): Promise<Pipeline> {
    return api.post<Pipeline>(`/pipelines/${id}/archive`);
  },
  restore(id: string): Promise<Pipeline> {
    return api.post<Pipeline>(`/pipelines/${id}/restore`);
  },
  deleteAndMoveStage(
    pipelineId: string,
    stageId: string,
    targetStageId: string,
  ): Promise<{ moved: number }> {
    return api.post<{ moved: number }>(
      `/pipelines/${pipelineId}/stages/${stageId}/delete-and-move`,
      { target_stage_id: targetStageId },
    );
  },
  get(id: string, signal?: AbortSignal): Promise<PipelineWithStages> {
    return api.get<PipelineWithStages>(`/pipelines/${id}`, { signal });
  },
  getBoard(pipelineId: string, filters: BoardFilters = {}, signal?: AbortSignal): Promise<BoardResponse> {
    return api.get<BoardResponse>(`/pipelines/${pipelineId}/board`, {
      query: filtersToQuery(filters),
      signal,
    });
  },
  create(input: CreatePipelineInput): Promise<Pipeline> {
    return api.post<Pipeline>('/pipelines', input);
  },
  update(id: string, input: UpdatePipelineInput): Promise<Pipeline> {
    return api.patch<Pipeline>(`/pipelines/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/pipelines/${id}`);
  },
  createStage(pipelineId: string, input: CreateStageInput): Promise<PipelineStage> {
    return api.post<PipelineStage>(`/pipelines/${pipelineId}/stages`, input);
  },
  updateStage(
    pipelineId: string,
    stageId: string,
    input: UpdateStageInput,
  ): Promise<PipelineStage> {
    return api.patch<PipelineStage>(`/pipelines/${pipelineId}/stages/${stageId}`, input);
  },
  removeStage(pipelineId: string, stageId: string): Promise<void> {
    return api.delete<void>(`/pipelines/${pipelineId}/stages/${stageId}`);
  },
  reorderStages(pipelineId: string, stageIds: string[]): Promise<PipelineStage[]> {
    return api.put<PipelineStage[]>(`/pipelines/${pipelineId}/stages/reorder`, {
      stage_ids: stageIds,
    });
  },
};

export type { Pipeline, PipelineStage };
