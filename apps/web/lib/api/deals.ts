import type { Deal, DealActivity, DealActivityType } from '@eclick-active/shared';
import { api } from './client';

export interface ListDealsParams {
  page?: number;
  limit?: number;
  pipeline_id?: string;
  stage_id?: string;
  assigned_to?: string;
  tags?: string[];
  min_value?: number;
  max_value?: number;
  include_closed?: boolean;
}

export interface PaginatedDeals {
  data: Deal[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateDealInput {
  title: string;
  pipeline_id: string;
  stage_id: string;
  contact_id?: string;
  company_id?: string;
  value?: number;
  currency?: string;
  expected_close_date?: string;
  assigned_to?: string;
  tags?: string[];
}

export interface UpdateDealInput {
  title?: string;
  value?: number;
  currency?: string;
  expected_close_date?: string | null;
  assigned_to?: string | null;
  tags?: string[];
  custom_fields?: Record<string, unknown>;
  conversation_id?: string | null;
}

export interface MoveDealInput {
  stage_id: string;
  position?: number;
  lost_reason?: string;
}

export interface ReorderDealsInput {
  stage_id: string;
  deal_ids: string[];
}

/**
 * Tipos que a UI pode criar manualmente. `stage_changed`, `value_changed`,
 * `assigned`, `task_created` e `score_changed` ficam reservados pra triggers
 * SQL ou serviços internos (espelha o whitelist do backend).
 */
export type UserCreatableActivityType = Extract<
  DealActivityType,
  'note_added' | 'email_sent' | 'call_made' | 'meeting_scheduled' | 'proposal_sent'
>;

export interface AddActivityInput {
  activity_type: UserCreatableActivityType;
  description: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export const dealsApi = {
  list(params: ListDealsParams = {}, signal?: AbortSignal): Promise<PaginatedDeals> {
    return api.get<PaginatedDeals>('/deals', {
      query: {
        page: params.page,
        limit: params.limit,
        pipeline_id: params.pipeline_id,
        stage_id: params.stage_id,
        assigned_to: params.assigned_to,
        tags: params.tags,
        min_value: params.min_value,
        max_value: params.max_value,
        include_closed: params.include_closed ? 'true' : undefined,
      },
      signal,
    });
  },
  create(input: CreateDealInput) {
    return api.post<Deal>('/deals', input);
  },
  update(id: string, input: UpdateDealInput) {
    return api.patch<Deal>(`/deals/${id}`, input);
  },
  move(id: string, input: MoveDealInput) {
    return api.post<Deal>(`/deals/${id}/move`, input);
  },
  reorder(input: ReorderDealsInput) {
    return api.put<Deal[]>('/deals/reorder', input);
  },
  remove(id: string) {
    return api.delete<void>(`/deals/${id}`);
  },
  getActivities(id: string, signal?: AbortSignal) {
    return api.get<DealActivity[]>(`/deals/${id}/activities`, { signal });
  },
  addActivity(id: string, input: AddActivityInput) {
    return api.post<DealActivity>(`/deals/${id}/activities`, input);
  },
  getById(id: string, signal?: AbortSignal) {
    return api.get<Deal & { contact?: unknown; company?: unknown; pipeline?: unknown; stage?: unknown }>(
      `/deals/${id}`,
      { signal },
    );
  },
};

export type { Deal, DealActivity };
