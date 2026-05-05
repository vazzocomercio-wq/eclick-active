import { api } from './client';

/**
 * Cliente do módulo SAC. Backend: apps/api/src/modules/sac/.
 * Migration: supabase/migrations/053_sac_tickets.sql.
 */

// ─── Tipos ────────────────────────────────────────────

export type SacCategory =
  | 'pre_sale'
  | 'post_sale'
  | 'order_status'
  | 'delivery_delay'
  | 'exchange'
  | 'return'
  | 'warranty'
  | 'cancellation'
  | 'refund'
  | 'defective_product'
  | 'wrong_product'
  | 'missing_parts'
  | 'invoice'
  | 'payment'
  | 'technical'
  | 'complaint'
  | 'mediation'
  | 'negative_review'
  | 'general';

export type SacStatus =
  | 'new'
  | 'in_progress'
  | 'waiting_customer'
  | 'waiting_internal'
  | 'resolved'
  | 'reopened'
  | 'cancelled';

export type SacPriority =
  | 'low'
  | 'normal'
  | 'high'
  | 'critical'
  | 'reputation_risk';

export type SacReputationRisk =
  | 'none'
  | 'low'
  | 'medium'
  | 'high'
  | 'critical';

export type SacDepartment =
  | 'sales'
  | 'support'
  | 'logistics'
  | 'finance'
  | 'management';

export type SacResolutionType =
  | 'resolved'
  | 'refunded'
  | 'exchanged'
  | 'returned'
  | 'cancelled'
  | 'escalated'
  | 'no_action_needed'
  | 'duplicate';

export type SacSentiment =
  | 'positive'
  | 'neutral'
  | 'frustrated'
  | 'angry'
  | 'very_angry';

export type SacActionType =
  | 'created'
  | 'status_changed'
  | 'priority_changed'
  | 'category_changed'
  | 'assigned'
  | 'escalated'
  | 'note_added'
  | 'response_sent'
  | 'order_linked'
  | 'order_checked'
  | 'logistics_contacted'
  | 'refund_initiated'
  | 'exchange_initiated'
  | 'sla_breached'
  | 'reopened'
  | 'resolved'
  | 'ai_classified'
  | 'ai_suggested'
  | 'preventive_created'
  | 'customer_rated';

export interface SacTicket {
  id: string;
  org_id: string;
  conversation_id: string | null;
  contact_id: string;
  ticket_number: number;
  category: SacCategory;
  subcategory: string | null;
  status: SacStatus;
  priority: SacPriority;
  reputation_risk_level: SacReputationRisk;
  sla_deadline_at: string | null;
  sla_first_response_at: string | null;
  sla_resolved_at: string | null;
  sla_breached: boolean;
  assigned_to: string | null;
  escalated_to: string | null;
  department: SacDepartment | null;
  order_id: string | null;
  order_marketplace: string | null;
  order_marketplace_id: string | null;
  order_status: string | null;
  order_tracking: string | null;
  order_value: number | null;
  order_data: Record<string, unknown> | null;
  ai_category: string | null;
  ai_priority: string | null;
  ai_sentiment: SacSentiment | null;
  ai_risk_score: number | null;
  ai_suggested_response: string | null;
  ai_summary: string | null;
  ai_resolution_suggestion: string | null;
  ai_classified_at: string | null;
  resolution_type: SacResolutionType | null;
  resolution_notes: string | null;
  customer_satisfaction: number | null;
  tags: string[];
  source_channel: string | null;
  is_preventive: boolean;
  created_by_ai: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  reopened_at: string | null;
  first_response_at: string | null;
}

export interface SacTicketAction {
  id: string;
  ticket_id: string;
  org_id: string;
  action_type: SacActionType;
  actor_type: 'agent' | 'system' | 'ai' | 'customer';
  actor_id: string | null;
  description: string | null;
  old_value: string | null;
  new_value: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface SacSlaRule {
  id: string;
  org_id: string;
  name: string;
  channel_type: string | null;
  category: string | null;
  priority: string | null;
  first_response_minutes: number;
  resolution_minutes: number;
  business_hours_only: boolean;
  is_active: boolean;
  specificity_score: number;
  created_at: string;
  updated_at: string;
}

export interface SacResponseTemplate {
  id: string;
  org_id: string;
  name: string;
  category: string | null;
  content: string;
  variables: string[];
  usage_count: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SacDashboardCounts {
  new: number;
  in_progress: number;
  waiting_customer: number;
  waiting_internal: number;
  resolved: number;
  critical: number;
  sla_due_soon: number;
  sla_breached: number;
  reputation_risk: number;
  resolved_today: number;
  total_open: number;
}

export interface SacSlaStats {
  fulfilled: number;
  breached: number;
  avg_first_response_minutes: number;
  avg_resolution_minutes: number;
  fulfilled_pct: number;
}

export interface SacListFilters {
  status?: SacStatus | SacStatus[];
  priority?: SacPriority | SacPriority[];
  category?: SacCategory | SacCategory[];
  assigned_to?: string;
  sla_breached?: boolean;
  reputation_risk_min?: SacReputationRisk;
  channel_type?: string;
  has_order?: boolean;
  is_preventive?: boolean;
  search?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export interface SacListResponse {
  rows: SacTicket[];
  total: number;
}

export interface SacAiClassification {
  category: SacCategory;
  subcategory?: string;
  priority: SacPriority;
  sentiment: SacSentiment;
  reputation_risk: SacReputationRisk;
  risk_score: number;
  summary: string;
  resolution_suggestion: string;
  suggested_response: string;
  confidence: number;
}

// ─── Builder helpers ──────────────────────────────────

function listToQuery(filters: SacListFilters): Record<string, string | number | undefined> {
  const out: Record<string, string | number | undefined> = {};
  if (filters.status) {
    out.status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
  }
  if (filters.priority) {
    out.priority = Array.isArray(filters.priority) ? filters.priority.join(',') : filters.priority;
  }
  if (filters.category) {
    out.category = Array.isArray(filters.category) ? filters.category.join(',') : filters.category;
  }
  if (filters.assigned_to) out.assigned_to = filters.assigned_to;
  if (filters.sla_breached !== undefined) out.sla_breached = String(filters.sla_breached);
  if (filters.reputation_risk_min) out.reputation_risk_min = filters.reputation_risk_min;
  if (filters.channel_type) out.channel_type = filters.channel_type;
  if (filters.has_order !== undefined) out.has_order = String(filters.has_order);
  if (filters.is_preventive !== undefined) out.is_preventive = String(filters.is_preventive);
  if (filters.search) out.search = filters.search;
  if (filters.date_from) out.date_from = filters.date_from;
  if (filters.date_to) out.date_to = filters.date_to;
  if (filters.page) out.page = filters.page;
  if (filters.page_size) out.page_size = filters.page_size;
  return out;
}

// ─── API ──────────────────────────────────────────────

export const sacApi = {
  // Tickets
  list: (filters: SacListFilters = {}, signal?: AbortSignal) =>
    api.get<SacListResponse>('/sac/tickets', {
      query: listToQuery(filters),
      signal,
    }),
  dashboard: (signal?: AbortSignal) =>
    api.get<SacDashboardCounts>('/sac/tickets/dashboard', { signal }),
  detail: (id: string, signal?: AbortSignal) =>
    api.get<SacTicket>(`/sac/tickets/${id}`, { signal }),
  actions: (id: string, signal?: AbortSignal) =>
    api.get<SacTicketAction[]>(`/sac/tickets/${id}/actions`, { signal }),
  byContact: (contactId: string, signal?: AbortSignal) =>
    api.get<SacTicket[]>(`/sac/tickets/by-contact/${contactId}`, { signal }),
  byConversation: (conversationId: string, signal?: AbortSignal) =>
    api.get<SacTicket | null>(`/sac/tickets/by-conversation/${conversationId}`, { signal }),
  create: (body: { contact_id: string; conversation_id?: string | null; category?: SacCategory; priority?: SacPriority; subcategory?: string; department?: SacDepartment; tags?: string[] }) =>
    api.post<SacTicket>('/sac/tickets', body),
  update: (id: string, body: Partial<{
    status: SacStatus;
    priority: SacPriority;
    category: SacCategory;
    subcategory: string | null;
    department: SacDepartment | null;
    assigned_to: string | null;
    reputation_risk_level: SacReputationRisk;
    tags: string[];
  }>) => api.patch<SacTicket>(`/sac/tickets/${id}`, body),
  assign: (id: string, agent_id: string) =>
    api.post<SacTicket>(`/sac/tickets/${id}/assign`, { agent_id }),
  escalate: (id: string, body: { to_agent_id: string; reason?: string }) =>
    api.post<SacTicket>(`/sac/tickets/${id}/escalate`, body),
  resolve: (id: string, body: { resolution_type: SacResolutionType; resolution_notes?: string }) =>
    api.post<SacTicket>(`/sac/tickets/${id}/resolve`, body),
  reopen: (id: string, reason?: string) =>
    api.post<SacTicket>(`/sac/tickets/${id}/reopen`, { reason }),
  addNote: (id: string, content: string) =>
    api.post<SacTicketAction>(`/sac/tickets/${id}/note`, { content }),
  linkOrder: (id: string, query: string) =>
    api.post<SacTicket>(`/sac/tickets/${id}/link-order`, { query }),
  rate: (id: string, rating: 1 | 2 | 3 | 4 | 5) =>
    api.post<SacTicket>(`/sac/tickets/${id}/rate`, { rating }),

  // SLA
  sla: {
    stats: (days = 30, signal?: AbortSignal) =>
      api.get<SacSlaStats>('/sac/sla/stats', { query: { days }, signal }),
    listRules: (signal?: AbortSignal) =>
      api.get<SacSlaRule[]>('/sac/sla/rules', { signal }),
    createRule: (body: Partial<SacSlaRule> & { name: string; first_response_minutes: number; resolution_minutes: number }) =>
      api.post<SacSlaRule>('/sac/sla/rules', body),
    updateRule: (id: string, body: Partial<SacSlaRule>) =>
      api.patch<SacSlaRule>(`/sac/sla/rules/${id}`, body),
    deleteRule: (id: string) => api.delete<void>(`/sac/sla/rules/${id}`),
  },

  // Templates
  templates: {
    list: (category?: string, signal?: AbortSignal) =>
      api.get<SacResponseTemplate[]>('/sac/templates', {
        query: category ? { category } : undefined,
        signal,
      }),
    create: (body: { name: string; content: string; category?: string; variables?: string[] }) =>
      api.post<SacResponseTemplate>('/sac/templates', body),
    update: (id: string, body: Partial<SacResponseTemplate>) =>
      api.patch<SacResponseTemplate>(`/sac/templates/${id}`, body),
    delete: (id: string) => api.delete<void>(`/sac/templates/${id}`),
  },

  // AI
  ai: {
    classify: (body: { message: string; history?: string[]; phone?: string; email?: string }) =>
      api.post<SacAiClassification | null>('/sac/ai/classify', body),
    suggest: (ticketId: string) =>
      api.post<string | null>(`/sac/ai/suggest/${ticketId}`, {}),
    performance: (period: 'today' | 'week' | 'month' = 'week') =>
      api.post<unknown>('/sac/ai/performance', { period }),
  },

  // Preventive
  runPreventive: () =>
    api.post<{ created: number }>('/sac/preventive/run', {}),
};
