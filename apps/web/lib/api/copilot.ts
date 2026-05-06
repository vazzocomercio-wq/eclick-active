import { api } from './client';

export type CopilotToolName =
  | 'search_contacts'
  | 'list_deals'
  | 'get_pipeline_summary'
  | 'list_conversations'
  | 'list_tasks'
  | 'get_agent_stats'
  | 'create_task'
  | 'create_deal'
  | 'search_knowledge'
  | 'search_live_sources'
  | 'check_available_slots'
  | 'schedule_appointment'
  | 'send_scheduling_link'
  | 'list_sac_tickets'
  | 'get_sac_dashboard'
  | 'get_sac_performance'
  | 'check_order_status';

export interface ToolCallRecord {
  tool: CopilotToolName;
  summary: string;
  resource_id?: string;
  resource_kind?: 'task' | 'deal';
  result_count?: number;
}

export interface CopilotMessageRecord {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  tool_calls: ToolCallRecord[];
  metadata: Record<string, unknown>;
  cost_usd: number;
  created_at: string;
}

export interface ProcessQueryResult {
  reply: string;
  tool_calls: ToolCallRecord[];
  cost_usd: number;
  latency_ms: number;
  assistant_message_id: string;
  /** ID da row em ai_interactions — pra UI permitir 👍/👎. Null se log falhou. */
  ai_interaction_id: string | null;
}

export type CopilotContextType = 'deal' | 'contact' | 'conversation' | 'general';

export interface CopilotContext {
  type: CopilotContextType;
  /** Obrigatório quando type !== 'general'. */
  id?: string;
}

export const copilotApi = {
  send(message: string, context?: CopilotContext): Promise<ProcessQueryResult> {
    const payload: Record<string, unknown> = { message };
    if (context && context.type !== 'general') {
      payload.context_type = context.type;
      if (context.id) payload.context_id = context.id;
    }
    return api.post<ProcessQueryResult>('/copilot/message', payload);
  },
  history(signal?: AbortSignal): Promise<CopilotMessageRecord[]> {
    return api.get<CopilotMessageRecord[]>('/copilot/history', { signal });
  },
  clear(): Promise<void> {
    return api.delete<void>('/copilot/history');
  },
};
