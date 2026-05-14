import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Task } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type { PaginatedResult } from '../contacts/contacts.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ListTasksQueryDto } from './dto/list-tasks.query.dto';
import { CalendarTasksQueryDto } from './dto/calendar-tasks.query.dto';
import { SaasCallbackClient } from './saas-callback.client';

/**
 * View enriquecida com nome do contato/deal/responsável (joins client-side).
 * Não criamos uma view SQL dedicada — os joins inline do PostgREST resolvem.
 */
export interface TaskRow extends Task {
  contact_name?: string | null;
  deal_title?: string | null;
  assignee_name?: string | null;
}

// Embeds só pra contact/deal (FKs reais). Assignee é resolvido separadamente
// em loadAssigneeNames() porque tasks.assigned_to não tem FK pra org_members
// (org_members.user_id não é único — chave composta é (org_id, user_id)).
const SELECT_WITH_JOINS =
  '*, contact:contacts(id, name, phone), deal:deals(id, title)';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly saasCallback: SaasCallbackClient,
  ) {}

  // ────────────────────────────────────────────
  // CREATE
  // ────────────────────────────────────────────

  async create(orgId: string, dto: CreateTaskDto, createdBy: string | null): Promise<Task> {
    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .insert({
        org_id: orgId,
        title: dto.title,
        description: dto.description ?? null,
        task_type: dto.task_type ?? 'follow_up',
        priority: dto.priority ?? 'normal',
        status: 'pending',
        deal_id: dto.deal_id ?? null,
        contact_id: dto.contact_id ?? null,
        conversation_id: dto.conversation_id ?? null,
        assigned_to: dto.assigned_to,
        due_date: dto.due_date ?? null,
        created_by_ai: dto.created_by_ai ?? false,
        ai_context: dto.ai_context ?? null,
        metadata: dto.metadata ?? {},
        created_by: createdBy,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create task');
    }
    return data as Task;
  }

  // ────────────────────────────────────────────
  // FIND ALL (com filtros, joins e paginação)
  // ────────────────────────────────────────────

  async findAll(
    orgId: string,
    filters: ListTasksQueryDto,
    currentUserId: string,
  ): Promise<PaginatedResult<TaskRow>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('tasks')
      .select(SELECT_WITH_JOINS, { count: 'exact' })
      .eq('org_id', orgId)
      .range(from, to);

    if (filters.status) q = q.eq('status', filters.status);
    if (filters.priority) q = q.eq('priority', filters.priority);
    if (filters.task_type) q = q.eq('task_type', filters.task_type);
    if (filters.deal_id) q = q.eq('deal_id', filters.deal_id);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);

    if (filters.mine) {
      q = q.eq('assigned_to', currentUserId);
    } else if (filters.assigned_to) {
      q = q.eq('assigned_to', filters.assigned_to);
    }

    if (filters.due_from) q = q.gte('due_date', filters.due_from);
    if (filters.due_to) q = q.lte('due_date', filters.due_to);

    if (filters.only_overdue) {
      const nowIso = new Date().toISOString();
      q = q.in('status', ['pending', 'in_progress']).lt('due_date', nowIso);
    }

    // Ordenação: overdue primeiro (heurística: due_date asc nulls last)
    // PostgREST não suporta CASE em order — ordena status pra deixar pending/in_progress no topo
    q = q
      .order('status', { ascending: true })
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []).map((r) => normalizeRow(r as RawTaskRow));
    await this.attachAssigneeNames(orgId, rows);

    return {
      data: rows,
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ────────────────────────────────────────────
  // FIND BY ID
  // ────────────────────────────────────────────

  async findById(orgId: string, id: string): Promise<TaskRow> {
    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .select(SELECT_WITH_JOINS)
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`Task ${id} not found`);
    }
    const row = normalizeRow(data as RawTaskRow);
    await this.attachAssigneeNames(orgId, [row]);
    return row;
  }

  // ────────────────────────────────────────────
  // UPDATE
  // ────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateTaskDto): Promise<Task> {
    const before = await this.findById(orgId, id);

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .update(dto)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update task');
    }

    // F5 (2026-05-14) — Se virou completed e veio do SaaS cadastro, dispara callback
    const updated = data as Task;
    if (
      (before as Task).status !== 'completed' &&
      updated.status === 'completed'
    ) {
      const source = (updated.metadata as Record<string, unknown> | null)?.source;
      if (typeof source === 'string') {
        void this.saasCallback.notifyTaskCompleted(updated.id, source);
      }
    }

    return updated;
  }

  // ────────────────────────────────────────────
  // COMPLETE — atalho para marcar concluída
  // ────────────────────────────────────────────

  async complete(orgId: string, id: string): Promise<Task> {
    const before = await this.findById(orgId, id);

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
      })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`complete failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to complete task');
    }

    // F5 (2026-05-14) — Callback reverso pro SaaS se task veio de cadastro
    const updated = data as Task;
    if ((before as Task).status !== 'completed') {
      const source = (updated.metadata as Record<string, unknown> | null)?.source;
      if (typeof source === 'string') {
        void this.saasCallback.notifyTaskCompleted(updated.id, source);
      }
    }

    return updated;
  }

  // ────────────────────────────────────────────
  // DELETE
  // ────────────────────────────────────────────

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);

    const { error } = await this.supabase.adminClient
      .from('tasks')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ────────────────────────────────────────────
  // GET MY TODAY — usado pela Central de Ação
  // ────────────────────────────────────────────

  async getMyToday(orgId: string, userId: string): Promise<TaskRow[]> {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .select(SELECT_WITH_JOINS)
      .eq('org_id', orgId)
      .eq('assigned_to', userId)
      .in('status', ['pending', 'in_progress'])
      .lte('due_date', endOfDay.toISOString())
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(50);

    if (error) {
      this.logger.error(`getMyToday failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    const rows = (data ?? []).map((r) => normalizeRow(r as RawTaskRow));
    await this.attachAssigneeNames(orgId, rows);
    return rows;
  }

  // ────────────────────────────────────────────
  // GET OVERDUE
  // ────────────────────────────────────────────

  async getOverdue(orgId: string): Promise<TaskRow[]> {
    const nowIso = new Date().toISOString();

    const { data, error } = await this.supabase.adminClient
      .from('tasks')
      .select(SELECT_WITH_JOINS)
      .eq('org_id', orgId)
      .in('status', ['pending', 'in_progress'])
      .lt('due_date', nowIso)
      .order('due_date', { ascending: true })
      .limit(100);

    if (error) {
      this.logger.error(`getOverdue failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    const rows = (data ?? []).map((r) => normalizeRow(r as RawTaskRow));
    await this.attachAssigneeNames(orgId, rows);
    return rows;
  }

  // ────────────────────────────────────────────
  // GET CALENDAR — agrupado por dia (YYYY-MM-DD)
  // ────────────────────────────────────────────

  async getCalendar(
    orgId: string,
    filters: CalendarTasksQueryDto,
  ): Promise<CalendarDay[]> {
    let q = this.supabase.adminClient
      .from('tasks')
      .select(SELECT_WITH_JOINS)
      .eq('org_id', orgId)
      .gte('due_date', filters.from)
      .lte('due_date', filters.to)
      .not('due_date', 'is', null)
      .order('due_date', { ascending: true })
      .limit(1000);

    if (filters.user_id) q = q.eq('assigned_to', filters.user_id);
    if (filters.task_type && filters.task_type.length > 0) {
      q = q.in('task_type', filters.task_type);
    }

    const { data, error } = await q;
    if (error) {
      this.logger.error(`getCalendar failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []).map((r) => normalizeRow(r as RawTaskRow));
    await this.attachAssigneeNames(orgId, rows);

    // Agrupa por YYYY-MM-DD (timezone do servidor)
    const byDate = new Map<string, CalendarTask[]>();
    for (const t of rows) {
      if (!t.due_date) continue;
      const date = isoToLocalDateKey(t.due_date);
      const slim: CalendarTask = {
        id: t.id,
        title: t.title,
        task_type: t.task_type,
        priority: t.priority,
        status: t.status,
        due_date: t.due_date,
        contact_id: t.contact_id,
        contact_name: t.contact_name ?? null,
        deal_id: t.deal_id,
        deal_title: t.deal_title ?? null,
        assigned_to: t.assigned_to,
        assigned_to_name: t.assignee_name ?? null,
      };
      const arr = byDate.get(date);
      if (arr) arr.push(slim);
      else byDate.set(date, [slim]);
    }

    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, tasks]) => ({ date, tasks }));
  }

  // ────────────────────────────────────────────
  // Helper: batched lookup de display_name dos assignees
  // ────────────────────────────────────────────

  private async attachAssigneeNames(orgId: string, rows: TaskRow[]): Promise<void> {
    if (rows.length === 0) return;

    const userIds = Array.from(
      new Set(rows.map((r) => r.assigned_to).filter((v): v is string => !!v)),
    );
    if (userIds.length === 0) return;

    const { data, error } = await this.supabase.adminClient
      .from('org_members')
      .select('user_id, display_name')
      .eq('org_id', orgId)
      .in('user_id', userIds);

    if (error) {
      this.logger.warn(`attachAssigneeNames failed: ${error.message}`);
      return;
    }

    const byUserId = new Map<string, string | null>();
    for (const m of data ?? []) {
      byUserId.set(m.user_id as string, (m.display_name as string | null) ?? null);
    }

    for (const r of rows) {
      if (r.assigned_to) {
        r.assignee_name = byUserId.get(r.assigned_to) ?? null;
      }
    }
  }
}

// ────────────────────────────────────────────
// Calendar shape
// ────────────────────────────────────────────

export interface CalendarTask {
  id: string;
  title: string;
  task_type: Task['task_type'];
  priority: Task['priority'];
  status: Task['status'];
  due_date: string;
  contact_id: string | null;
  contact_name: string | null;
  deal_id: string | null;
  deal_title: string | null;
  assigned_to: string;
  assigned_to_name: string | null;
}

export interface CalendarDay {
  /** YYYY-MM-DD (timezone do servidor) */
  date: string;
  tasks: CalendarTask[];
}

function isoToLocalDateKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ────────────────────────────────────────────
// Helpers de normalização das joins
// ────────────────────────────────────────────

interface RawTaskRow extends Task {
  contact?: { id: string; name: string | null; phone: string | null } | Array<{ id: string; name: string | null; phone: string | null }> | null;
  deal?: { id: string; title: string } | Array<{ id: string; title: string }> | null;
}

function pickOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function normalizeRow(raw: RawTaskRow): TaskRow {
  const contact = pickOne(raw.contact);
  const deal = pickOne(raw.deal);

  // Strip the nested join keys before returning the flat shape
  const { contact: _c, deal: _d, ...rest } = raw;
  void _c;
  void _d;

  return {
    ...(rest as Task),
    contact_name: contact?.name ?? contact?.phone ?? null,
    deal_title: deal?.title ?? null,
    assignee_name: null, // preenchido depois por attachAssigneeNames()
  };
}
