import type { AutomationLogStatus, AutomationTriggerType } from '@eclick-active/shared';
import { api } from './client';

// ──────────────────────────────────────────────────────────
// Automation tipos UI-friendly (mantém em sync com backend)
// ──────────────────────────────────────────────────────────

export type AutomationActionType =
  | 'send_message'
  | 'create_task'
  | 'move_deal'
  | 'update_contact'
  | 'assign_conversation'
  | 'notify_agent'
  | 'wait';

export interface AutomationAction {
  type: AutomationActionType;
  // Campos específicos por tipo (todos opcionais no nível do tipo amplo)
  text?: string;
  channel_id?: string;
  title?: string;
  task_type?: string;
  due_in_hours?: number;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  to_stage_id?: string;
  add_tags?: string[];
  remove_tags?: string[];
  temperature?: 'cold' | 'warm' | 'hot' | 'very_hot';
  assigned_to?: string;
  message?: string;
  user_id?: string;
  minutes?: number;
}

export interface Automation {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
  natural_language_source: string | null;
  is_active: boolean;
  execution_count: number;
  last_executed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActionExecutionLog {
  index: number;
  type: AutomationActionType;
  status: 'success' | 'failed' | 'skipped';
  duration_ms: number;
  output?: Record<string, unknown>;
  error?: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  status: AutomationLogStatus;
  error: string | null;
  duration_ms: number | null;
  trigger_event: Record<string, unknown>;
  actions_executed: ActionExecutionLog[];
  created_at: string;
}

export interface CreateAutomationInput {
  name: string;
  description?: string;
  trigger_type: AutomationTriggerType;
  trigger_config?: Record<string, unknown>;
  actions: AutomationAction[];
  is_active?: boolean;
  natural_language_source?: string;
  /** Vincula automação a um stage do funil (Funil Digital). */
  stage_id?: string | null;
}

export interface UpdateAutomationInput {
  name?: string;
  description?: string;
  trigger_type?: AutomationTriggerType;
  trigger_config?: Record<string, unknown>;
  actions?: AutomationAction[];
  is_active?: boolean;
  stage_id?: string | null;
}

export interface GeneratedAutomation {
  name: string;
  description: string;
  trigger_type: AutomationTriggerType;
  trigger_config: Record<string, unknown>;
  actions: AutomationAction[];
}

export const automationsApi = {
  list(
    options: { stageId?: string; globalOnly?: boolean } = {},
    signal?: AbortSignal,
  ): Promise<Automation[]> {
    return api.get<Automation[]>('/automations', {
      query: {
        ...(options.stageId ? { stage_id: options.stageId } : {}),
        ...(options.globalOnly ? { global_only: 'true' } : {}),
      },
      signal,
    });
  },
  get(id: string, signal?: AbortSignal): Promise<Automation> {
    return api.get<Automation>(`/automations/${id}`, { signal });
  },
  create(input: CreateAutomationInput): Promise<Automation> {
    return api.post<Automation>('/automations', input);
  },
  update(id: string, input: UpdateAutomationInput): Promise<Automation> {
    return api.patch<Automation>(`/automations/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/automations/${id}`);
  },
  toggle(id: string): Promise<Automation> {
    return api.post<Automation>(`/automations/${id}/toggle`);
  },
  test(id: string): Promise<{ status: AutomationLogStatus; logs: ActionExecutionLog[] }> {
    return api.post<{ status: AutomationLogStatus; logs: ActionExecutionLog[] }>(
      `/automations/${id}/test`,
    );
  },
  logs(id: string, signal?: AbortSignal): Promise<AutomationLog[]> {
    return api.get<AutomationLog[]>(`/automations/${id}/logs`, { signal });
  },
  generate(description: string): Promise<GeneratedAutomation> {
    return api.post<GeneratedAutomation>('/automations/generate', {
      description,
    });
  },
};
