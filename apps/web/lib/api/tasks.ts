import type {
  Task,
  TaskPriority,
  TaskStatus,
  TaskType,
} from '@eclick-active/shared';
import { api } from './client';

export interface TaskRow extends Task {
  contact_name?: string | null;
  deal_title?: string | null;
  assignee_name?: string | null;
}

export interface ListTasksParams {
  page?: number;
  limit?: number;
  status?: TaskStatus;
  priority?: TaskPriority;
  task_type?: TaskType;
  assigned_to?: string;
  deal_id?: string;
  contact_id?: string;
  due_from?: string;
  due_to?: string;
  only_overdue?: boolean;
  mine?: boolean;
}

export interface PaginatedTasks {
  data: TaskRow[];
  page: number;
  limit: number;
  total: number;
}

export interface CreateTaskInput {
  title: string;
  assigned_to: string;
  description?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  deal_id?: string;
  contact_id?: string;
  conversation_id?: string;
  due_date?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  task_type?: TaskType;
  priority?: TaskPriority;
  status?: TaskStatus;
  deal_id?: string | null;
  contact_id?: string | null;
  assigned_to?: string;
  due_date?: string | null;
}

function paramsToQuery(params: ListTasksParams): Record<string, string | number | undefined> {
  return {
    page: params.page,
    limit: params.limit,
    status: params.status,
    priority: params.priority,
    task_type: params.task_type,
    assigned_to: params.assigned_to,
    deal_id: params.deal_id,
    contact_id: params.contact_id,
    due_from: params.due_from,
    due_to: params.due_to,
    only_overdue: params.only_overdue ? 'true' : undefined,
    mine: params.mine ? 'true' : undefined,
  };
}

export const tasksApi = {
  list(params: ListTasksParams = {}, signal?: AbortSignal): Promise<PaginatedTasks> {
    return api.get<PaginatedTasks>('/tasks', { query: paramsToQuery(params), signal });
  },
  create(input: CreateTaskInput): Promise<Task> {
    return api.post<Task>('/tasks', input);
  },
  update(id: string, input: UpdateTaskInput): Promise<Task> {
    return api.patch<Task>(`/tasks/${id}`, input);
  },
  complete(id: string): Promise<Task> {
    return api.post<Task>(`/tasks/${id}/complete`);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/tasks/${id}`);
  },
  getById(id: string, signal?: AbortSignal): Promise<TaskRow> {
    return api.get<TaskRow>(`/tasks/${id}`, { signal });
  },
  myToday(signal?: AbortSignal): Promise<TaskRow[]> {
    return api.get<TaskRow[]>('/tasks/my/today', { signal });
  },
  overdue(signal?: AbortSignal): Promise<TaskRow[]> {
    return api.get<TaskRow[]>('/tasks/overdue', { signal });
  },
  calendar(
    params: CalendarTasksParams,
    signal?: AbortSignal,
  ): Promise<CalendarDay[]> {
    const query: Record<string, string | string[] | undefined> = {
      from: params.from,
      to: params.to,
      user_id: params.user_id,
    };
    if (params.task_type && params.task_type.length > 0) {
      query.task_type = params.task_type;
    }
    return api.get<CalendarDay[]>('/tasks/calendar', { query, signal });
  },
};

// ──────────────────────────────────────────────────────────
// Calendar
// ──────────────────────────────────────────────────────────

export interface CalendarTasksParams {
  /** ISO 8601 (date ou datetime) */
  from: string;
  /** ISO 8601 (date ou datetime) */
  to: string;
  user_id?: string;
  task_type?: TaskType[];
}

export interface CalendarTask {
  id: string;
  title: string;
  task_type: TaskType;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string;
  contact_id: string | null;
  contact_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
  assigned_to: string;
  assigned_to_name: string | null;
}

export interface CalendarDay {
  /** YYYY-MM-DD */
  date: string;
  tasks: CalendarTask[];
}
