import type { Pipeline, PipelineStage } from '@eclick-active/shared';
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

export const pipelinesApi = {
  list(signal?: AbortSignal) {
    return api.get<PipelineWithStages[]>('/pipelines', { signal });
  },
  get(id: string, signal?: AbortSignal) {
    return api.get<PipelineWithStages>(`/pipelines/${id}`, { signal });
  },
  getBoard(pipelineId: string, signal?: AbortSignal) {
    return api.get<BoardResponse>(`/pipelines/${pipelineId}/board`, { signal });
  },
};

export type { Pipeline, PipelineStage };
