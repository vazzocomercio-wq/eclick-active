import type { Deal, DealActivity } from '@eclick-active/shared';
import { api } from './client';

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

export const dealsApi = {
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
  getById(id: string, signal?: AbortSignal) {
    return api.get<Deal & { contact?: unknown; company?: unknown; pipeline?: unknown; stage?: unknown }>(
      `/deals/${id}`,
      { signal },
    );
  },
};

export type { Deal, DealActivity };
