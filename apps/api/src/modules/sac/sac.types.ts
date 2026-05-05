/**
 * Tipos do módulo SAC. Todos os enums espelham os CHECK constraints
 * em `active.sac_tickets`/`active.sac_ticket_actions` (M053).
 */

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
