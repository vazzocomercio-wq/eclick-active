import { api } from './client';

export interface DashboardMetrics {
  unread_conversations: number;
  hot_leads: number;
  pipeline_value: number;
  pending_tasks_today: number;
}

export type AttentionItemKind =
  | 'unanswered_conversation'
  | 'sla_breached_deal'
  | 'overdue_task'
  | 'high_risk_deal';

export interface AttentionItem {
  id: string;
  kind: AttentionItemKind;
  title: string;
  description: string;
  since: string;
  href: string;
  severity: 'urgent' | 'high' | 'medium';
  ref_id: string;
}

export interface HotLeadItem {
  id: string;
  name: string | null;
  avatar_url: string | null;
  temperature: 'cold' | 'warm' | 'hot' | 'very_hot' | null;
  score: number;
  last_message_preview: string | null;
  last_message_at: string | null;
  conversation_id: string | null;
}

export interface TopDealItem {
  id: string;
  title: string;
  value: number;
  currency: string;
  contact_name: string | null;
  stage_name: string;
  stage_color: string;
  ai_close_probability: number | null;
}

export type RecentActivityKind =
  | 'message_received'
  | 'message_sent'
  | 'deal_stage_changed'
  | 'deal_won'
  | 'deal_lost'
  | 'task_completed'
  | 'note_added'
  | 'other';

export interface RecentActivityItem {
  id: string;
  kind: RecentActivityKind;
  title: string;
  description: string | null;
  contact_name: string | null;
  created_at: string;
  href: string | null;
}

export interface DashboardSummary {
  metrics: DashboardMetrics;
  attention: AttentionItem[];
  hot_leads: HotLeadItem[];
  top_deals: TopDealItem[];
  recent_activity: RecentActivityItem[];
}

export const dashboardApi = {
  getSummary(signal?: AbortSignal): Promise<DashboardSummary> {
    return api.get<DashboardSummary>('/dashboard/summary', { signal });
  },
};
