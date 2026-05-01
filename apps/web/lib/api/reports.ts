import { api } from './client';

export type ReportType = 'sales' | 'agents' | 'channels' | 'funnel';

export interface PeriodInput {
  from?: string;
  to?: string;
}

export interface SalesReport {
  period: { from: string; to: string };
  totals: {
    revenue: number;
    deals_won: number;
    deals_lost: number;
    deals_open: number;
    avg_ticket: number;
    conversion_rate: number;
    avg_cycle_days: number | null;
  };
  weekly_series: Array<{
    week_start: string;
    won: number;
    lost: number;
    revenue: number;
  }>;
  revenue_cumulative: Array<{ date: string; revenue: number }>;
  lost_reasons: Array<{ reason: string; count: number }>;
}

export interface AgentReport {
  period: { from: string; to: string };
  agents: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    conversations_handled: number;
    avg_first_response_ms: number | null;
    deals_won: number;
    deals_lost: number;
    revenue: number;
    tasks_completed: number;
    ai_score: number | null;
  }>;
}

export interface ChannelReport {
  period: { from: string; to: string };
  channels: Array<{
    channel_type: string;
    conversations: number;
    leads: number;
    conversion_rate: number;
  }>;
  total_conversations: number;
}

export interface FunnelReport {
  period: { from: string; to: string };
  pipeline: { id: string; name: string };
  stages: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    is_won: boolean;
    is_lost: boolean;
    deals_count: number;
    total_value: number;
    avg_time_in_stage_hours: number | null;
    conversion_rate: number | null;
    drop_off_rate: number | null;
  }>;
  bottleneck_stage_id: string | null;
}

export interface InterpretResult {
  summary: string;
  insights: string[];
  recommendations: string[];
}

function periodToQuery(p: PeriodInput): Record<string, string | undefined> {
  return { from: p.from, to: p.to };
}

export const reportsApi = {
  sales(period: PeriodInput = {}, signal?: AbortSignal): Promise<SalesReport> {
    return api.get<SalesReport>('/reports/sales', {
      query: periodToQuery(period),
      signal,
    });
  },
  agents(period: PeriodInput = {}, signal?: AbortSignal): Promise<AgentReport> {
    return api.get<AgentReport>('/reports/agents', {
      query: periodToQuery(period),
      signal,
    });
  },
  channels(period: PeriodInput = {}, signal?: AbortSignal): Promise<ChannelReport> {
    return api.get<ChannelReport>('/reports/channels', {
      query: periodToQuery(period),
      signal,
    });
  },
  funnel(
    pipelineId: string,
    period: PeriodInput = {},
    signal?: AbortSignal,
  ): Promise<FunnelReport> {
    return api.get<FunnelReport>(`/reports/funnel/${pipelineId}`, {
      query: periodToQuery(period),
      signal,
    });
  },
  interpret(
    reportType: ReportType,
    data: Record<string, unknown>,
  ): Promise<InterpretResult> {
    return api.post<InterpretResult>('/reports/interpret', {
      report_type: reportType,
      data,
    });
  },
};
