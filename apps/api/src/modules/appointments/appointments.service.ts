import {
  BadRequestException,
  ConflictException,
  forwardRef,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Appointment,
  AppointmentDetail,
  AppointmentType,
  AvailabilitySlot,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CalendarIntegrationsService } from '../calendar-integrations/calendar-integrations.service';
import { GoogleCalendarService } from '../calendar-integrations/google-calendar.service';
import { AppointmentTypesService } from './appointment-types.service';
import {
  CalendarRangeQueryDto,
  CreateAppointmentDto,
  GetSlotsQueryDto,
  ListAppointmentsQueryDto,
  RescheduleAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

interface TimeRange {
  start: Date;
  end: Date;
}

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly types: AppointmentTypesService,
    @Inject(forwardRef(() => CalendarIntegrationsService))
    private readonly integrations: CalendarIntegrationsService,
    @Inject(forwardRef(() => GoogleCalendarService))
    private readonly google: GoogleCalendarService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateAppointmentDto, createdByAi = false): Promise<AppointmentDetail> {
    const start = new Date(dto.start_time);
    const end = new Date(dto.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException('Datas inválidas');
    }
    if (end <= start) {
      throw new BadRequestException('end_time precisa ser maior que start_time');
    }

    // Validações de negócio quando há agente atribuído
    if (dto.assigned_to) {
      await this.assertNoConflict(orgId, dto.assigned_to, start, end);
    }

    if (dto.appointment_type_id) {
      const type = await this.types.findById(orgId, dto.appointment_type_id);
      await this.assertWithinTypeRules(orgId, type, start, dto.assigned_to);
    }

    const { data, error } = await this.supabase.adminClient
      .from('appointments')
      .insert({
        org_id: orgId,
        appointment_type_id: dto.appointment_type_id ?? null,
        contact_id: dto.contact_id ?? null,
        deal_id: dto.deal_id ?? null,
        conversation_id: dto.conversation_id ?? null,
        assigned_to: dto.assigned_to ?? null,
        title: dto.title,
        description: dto.description ?? null,
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        location_type: dto.location_type ?? null,
        location_details: dto.location_details ?? null,
        notes: dto.notes ?? null,
        created_by_ai: createdByAi,
        metadata: dto.metadata ?? {},
      })
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Falha ao criar agendamento');
    }

    const created = data as Appointment;

    // Sync com Google Calendar (se agente tem integração ativa) — best-effort
    if (dto.assigned_to) {
      void this.syncToGoogleAfterCreate(orgId, created.id, dto.assigned_to).catch((err) => {
        this.logger.warn(
          `sync to google after create falhou (não-fatal): ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    return this.findById(orgId, created.id);
  }

  /**
   * Cria evento correspondente no Google Calendar do agente (se conectado).
   * Salva external_calendar_id no appointment pra permitir update/delete.
   */
  private async syncToGoogleAfterCreate(
    orgId: string,
    appointmentId: string,
    agentId: string,
  ): Promise<void> {
    const integration = await this.integrations.findActiveForAgent(orgId, agentId, 'google');
    if (!integration || !integration.calendar_id) return;

    const appt = await this.findById(orgId, appointmentId);
    const ev = await this.google.createEvent(integration.id, integration.calendar_id, {
      title: appt.title,
      description: appt.description,
      start_time: appt.start_time,
      end_time: appt.end_time,
      location_details: appt.location_details,
      contact_email:
        (appt.metadata as { contact_email?: string } | null)?.contact_email ?? null,
    });

    await this.supabase.adminClient
      .from('appointments')
      .update({
        external_calendar_id: ev.event_id,
        external_calendar_provider: 'google',
        metadata: {
          ...(appt.metadata ?? {}),
          google_html_link: ev.html_link,
        },
      })
      .eq('org_id', orgId)
      .eq('id', appointmentId);
  }

  async findAll(
    orgId: string,
    filters: ListAppointmentsQueryDto,
    currentMemberId?: string,
  ): Promise<AppointmentDetail[]> {
    let q = this.supabase.adminClient
      .from('appointments')
      .select(this.detailSelect())
      .eq('org_id', orgId)
      .order('start_time', { ascending: true });

    if (filters.agent_id) q = q.eq('assigned_to', filters.agent_id);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);
    if (filters.deal_id) q = q.eq('deal_id', filters.deal_id);
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.date_from) q = q.gte('start_time', filters.date_from);
    if (filters.date_to) q = q.lte('start_time', filters.date_to);
    if (filters.mine === 'true' && currentMemberId) {
      q = q.eq('assigned_to', currentMemberId);
    }

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    return ((data ?? []) as unknown[]).map((r) => this.normalizeDetail(r));
  }

  async findById(orgId: string, id: string): Promise<AppointmentDetail> {
    const { data, error } = await this.supabase.adminClient
      .from('appointments')
      .select(this.detailSelect())
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Appointment ${id} não encontrado`);
    return this.normalizeDetail(data);
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateAppointmentDto,
  ): Promise<AppointmentDetail> {
    await this.findById(orgId, id);

    const patch: Record<string, unknown> = {};
    for (const k of [
      'title',
      'description',
      'start_time',
      'end_time',
      'appointment_type_id',
      'assigned_to',
      'status',
      'location_type',
      'location_details',
      'notes',
      'metadata',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }

    const { error } = await this.supabase.adminClient
      .from('appointments')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
    return this.findById(orgId, id);
  }

  async cancel(orgId: string, id: string, reason?: string): Promise<AppointmentDetail> {
    const existing = await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('appointments')
      .update({ status: 'cancelled', cancelled_reason: reason ?? null })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);

    // Deleta evento no Google se sincronizado — best-effort
    if (
      existing.external_calendar_id &&
      existing.external_calendar_provider === 'google' &&
      existing.assigned_to
    ) {
      void this.deleteFromGoogle(orgId, existing.assigned_to, existing.external_calendar_id).catch(
        (err) => this.logger.warn(`delete google falhou: ${err instanceof Error ? err.message : String(err)}`),
      );
    }

    return this.findById(orgId, id);
  }

  private async deleteFromGoogle(
    orgId: string,
    agentId: string,
    eventId: string,
  ): Promise<void> {
    const integration = await this.integrations.findActiveForAgent(orgId, agentId, 'google');
    if (!integration || !integration.calendar_id) return;
    await this.google.deleteEvent(integration.id, integration.calendar_id, eventId);
  }

  async complete(orgId: string, id: string): Promise<AppointmentDetail> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('appointments')
      .update({ status: 'completed' })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);
    return this.findById(orgId, id);
  }

  /**
   * Marca como no_show. Cria task de recontato pro agente automaticamente.
   */
  async markNoShow(orgId: string, id: string): Promise<AppointmentDetail> {
    const appt = await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('appointments')
      .update({ status: 'no_show' })
      .eq('org_id', orgId)
      .eq('id', id);
    if (error) throw new InternalServerErrorException(error.message);

    // Cria task de recontato (best-effort — não bloqueia o no-show)
    if (appt.assigned_to && appt.contact_id) {
      void this.supabase.adminClient
        .from('tasks')
        .insert({
          org_id: orgId,
          title: `Recontato — ${appt.contact?.name ?? 'cliente'} não compareceu`,
          description: `O cliente não compareceu ao agendamento "${appt.title}". Tente reagendar ou descobrir o motivo.`,
          task_type: 'follow_up',
          priority: 'high',
          status: 'pending',
          assigned_to: appt.agent?.id ?? null,
          contact_id: appt.contact_id,
          deal_id: appt.deal_id ?? null,
          due_date: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          created_by_ai: true,
          ai_context: 'No-show automático do appointment',
        })
        .then(() => {})
        .then(undefined, () => {});
    }

    return this.findById(orgId, id);
  }

  /**
   * Cancela o appointment original e cria um novo com rescheduled_from
   * apontando pra ele. Retorna o NOVO appointment.
   */
  async reschedule(
    orgId: string,
    id: string,
    dto: RescheduleAppointmentDto,
  ): Promise<AppointmentDetail> {
    const original = await this.findById(orgId, id);
    if (original.status !== 'scheduled' && original.status !== 'confirmed') {
      throw new BadRequestException(`Appointment com status ${original.status} não pode ser reagendado`);
    }

    const newStart = new Date(dto.start_time);
    const duration = new Date(original.end_time).getTime() - new Date(original.start_time).getTime();
    const newEnd = dto.end_time ? new Date(dto.end_time) : new Date(newStart.getTime() + duration);

    if (original.assigned_to) {
      await this.assertNoConflict(orgId, original.assigned_to, newStart, newEnd, id);
    }

    // Cancela original (status='rescheduled')
    await this.supabase.adminClient
      .from('appointments')
      .update({ status: 'rescheduled' })
      .eq('org_id', orgId)
      .eq('id', id);

    // Cria novo
    const { data, error } = await this.supabase.adminClient
      .from('appointments')
      .insert({
        org_id: orgId,
        appointment_type_id: original.appointment_type_id,
        contact_id: original.contact_id,
        deal_id: original.deal_id,
        conversation_id: original.conversation_id,
        assigned_to: original.assigned_to,
        title: original.title,
        description: original.description,
        start_time: newStart.toISOString(),
        end_time: newEnd.toISOString(),
        location_type: original.location_type,
        location_details: original.location_details,
        notes: original.notes,
        rescheduled_from: id,
        metadata: { ...(original.metadata ?? {}), rescheduled_at: new Date().toISOString() },
      })
      .select('id')
      .single();
    if (error || !data) {
      throw new InternalServerErrorException(error?.message ?? 'Falha ao reagendar');
    }
    const newId = (data as { id: string }).id;

    // Sincroniza com Google: deleta evento original + cria novo
    if (
      original.external_calendar_id &&
      original.external_calendar_provider === 'google' &&
      original.assigned_to
    ) {
      void this.deleteFromGoogle(
        orgId,
        original.assigned_to,
        original.external_calendar_id,
      ).catch(() => {});
      void this.syncToGoogleAfterCreate(orgId, newId, original.assigned_to).catch(() => {});
    }

    return this.findById(orgId, newId);
  }

  // ──────────────────────────────────────────────────────────
  // Slots disponíveis (algoritmo principal)
  // ──────────────────────────────────────────────────────────

  /**
   * Calcula slots disponíveis para uma data:
   *   1. Pega janela base (business_hours da org ou agent_availability)
   *   2. Subtrai appointments existentes (com buffer)
   *   3. Subtrai tasks com horário do dia
   *   4. Retorna slots de duração igual à do tipo (ou 30min default)
   *
   * Se agent_id não passado, retorna slots de TODOS os agentes ativos.
   */
  async getAvailableSlots(
    orgId: string,
    query: GetSlotsQueryDto,
  ): Promise<AvailabilitySlot[]> {
    const date = new Date(query.date + 'T00:00:00Z');
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Data inválida');

    const dayStart = new Date(date);
    dayStart.setUTCHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setUTCHours(23, 59, 59, 999);

    // Tipo (pra duração + buffer + min_advance)
    let type: AppointmentType | null = null;
    let durationMinutes = 30;
    let bufferMinutes = 15;
    let minAdvanceHours = 2;
    if (query.type_id) {
      type = await this.types.findById(orgId, query.type_id);
      durationMinutes = type.duration_minutes;
      bufferMinutes = type.buffer_minutes;
      minAdvanceHours = type.min_advance_hours;
    }

    // Lista de agentes — todos ativos da org se não especificado
    const agents = await this.resolveAgents(orgId, query.agent_id);
    if (agents.length === 0) return [];

    // Janela base por org (business_hours)
    const orgWindow = await this.fetchOrgBusinessHoursForDate(orgId, dayStart);

    const minStartTime = new Date(Date.now() + minAdvanceHours * 60 * 60 * 1000);

    const slots: AvailabilitySlot[] = [];

    for (const agent of agents) {
      // Janela do agente (override se houver, senão herda business_hours)
      const agentWindows = await this.resolveAgentWindow(
        orgId,
        agent.id,
        dayStart,
        orgWindow,
      );
      if (agentWindows.length === 0) continue;

      // Busy ranges = appointments + tasks com horário
      const busy = await this.fetchBusyRanges(orgId, agent.id, dayStart, dayEnd);

      for (const win of agentWindows) {
        const winSlots = this.generateSlots(
          win,
          durationMinutes,
          bufferMinutes,
          busy,
          minStartTime,
        );
        for (const s of winSlots) {
          slots.push({
            start_time: s.start.toISOString(),
            end_time: s.end.toISOString(),
            agent_id: agent.id,
            agent_name: agent.display_name,
          });
        }
      }
    }

    return slots.sort((a, b) => a.start_time.localeCompare(b.start_time));
  }

  // ──────────────────────────────────────────────────────────
  // Calendar — pra UI semanal/mensal
  // ──────────────────────────────────────────────────────────

  async getCalendarRange(
    orgId: string,
    range: CalendarRangeQueryDto,
  ): Promise<AppointmentDetail[]> {
    return this.findAll(orgId, {
      date_from: range.from,
      date_to: range.to,
      ...(range.agent_id ? { agent_id: range.agent_id } : {}),
    });
  }

  async getMyToday(orgId: string, userId: string): Promise<AppointmentDetail[]> {
    // Resolve org_member.id via user_id
    const memberId = await this.resolveMemberId(orgId, userId);
    if (!memberId) return [];

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date();
    end.setHours(23, 59, 59, 999);

    return this.findAll(
      orgId,
      {
        agent_id: memberId,
        date_from: start.toISOString(),
        date_to: end.toISOString(),
      },
    );
  }

  // ──────────────────────────────────────────────────────────
  // Reminders & no-show — chamado pelo worker (setInterval)
  // ──────────────────────────────────────────────────────────

  /**
   * Retorna appointments que precisam receber lembrete.
   * - 24h: between now+23h and now+25h (janela de 2h pra cobrir o ciclo do worker)
   * - 1h: between now+30min and now+90min
   */
  async findRemindersDue(): Promise<{
    twentyFourH: AppointmentDetail[];
    oneH: AppointmentDetail[];
    noShow: AppointmentDetail[];
  }> {
    const now = Date.now();
    const in23h = new Date(now + 23 * 60 * 60 * 1000).toISOString();
    const in25h = new Date(now + 25 * 60 * 60 * 1000).toISOString();
    const in30m = new Date(now + 30 * 60 * 1000).toISOString();
    const in90m = new Date(now + 90 * 60 * 1000).toISOString();
    const past30m = new Date(now - 30 * 60 * 1000).toISOString();
    const past2h = new Date(now - 2 * 60 * 60 * 1000).toISOString();

    const [r24, r1, ns] = await Promise.all([
      this.supabase.adminClient
        .from('appointments')
        .select(this.detailSelect())
        .eq('reminder_sent_24h', false)
        .in('status', ['scheduled', 'confirmed'])
        .gte('start_time', in23h)
        .lte('start_time', in25h),
      this.supabase.adminClient
        .from('appointments')
        .select(this.detailSelect())
        .eq('reminder_sent_1h', false)
        .in('status', ['scheduled', 'confirmed'])
        .gte('start_time', in30m)
        .lte('start_time', in90m),
      this.supabase.adminClient
        .from('appointments')
        .select(this.detailSelect())
        .eq('status', 'scheduled')
        .lt('start_time', past30m)
        .gte('start_time', past2h),
    ]);

    const norm = (x: { data: unknown[] | null }) =>
      ((x.data ?? []) as unknown[]).map((r) => this.normalizeDetail(r));

    return {
      twentyFourH: norm(r24),
      oneH: norm(r1),
      noShow: norm(ns),
    };
  }

  async markReminderSent(id: string, kind: '24h' | '1h'): Promise<void> {
    const field = kind === '24h' ? 'reminder_sent_24h' : 'reminder_sent_1h';
    await this.supabase.adminClient
      .from('appointments')
      .update({ [field]: true })
      .eq('id', id);
  }

  // ──────────────────────────────────────────────────────────
  // Helpers internos
  // ──────────────────────────────────────────────────────────

  private detailSelect(): string {
    return [
      '*',
      'contact:contacts(id, name, phone, avatar_url)',
      'deal:deals(id, title, value, currency)',
      'agent:org_members!appointments_assigned_to_fkey(id, display_name, avatar_url)',
      'type:appointment_types(id, name, color, duration_minutes, location_type)',
    ].join(', ');
  }

  private normalizeDetail(row: unknown): AppointmentDetail {
    const r = row as Record<string, unknown>;
    const flatten = <T>(v: unknown): T | null => {
      if (Array.isArray(v)) return (v[0] as T) ?? null;
      return (v as T) ?? null;
    };
    return {
      ...(r as unknown as Appointment),
      contact: flatten(r.contact),
      deal: flatten(r.deal),
      agent: flatten(r.agent),
      type: flatten(r.type),
    } as AppointmentDetail;
  }

  private async assertNoConflict(
    orgId: string,
    agentId: string,
    start: Date,
    end: Date,
    excludeId?: string,
  ): Promise<void> {
    let q = this.supabase.adminClient
      .from('appointments')
      .select('id, start_time, end_time')
      .eq('org_id', orgId)
      .eq('assigned_to', agentId)
      .in('status', ['scheduled', 'confirmed'])
      .lt('start_time', end.toISOString())
      .gt('end_time', start.toISOString());
    if (excludeId) q = q.neq('id', excludeId);

    const { data, error } = await q;
    if (error) throw new InternalServerErrorException(error.message);
    if ((data ?? []).length > 0) {
      throw new ConflictException('Conflito de horário com outro agendamento do mesmo agente');
    }
  }

  private async assertWithinTypeRules(
    orgId: string,
    type: AppointmentType,
    start: Date,
    agentId?: string,
  ): Promise<void> {
    const minStart = new Date(Date.now() + type.min_advance_hours * 60 * 60 * 1000);
    if (start < minStart) {
      throw new BadRequestException(
        `Antecedência mínima de ${type.min_advance_hours}h não respeitada`,
      );
    }

    // max_per_day por agente
    if (agentId && type.max_per_day) {
      const dayStart = new Date(start);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(start);
      dayEnd.setHours(23, 59, 59, 999);
      const { count } = await this.supabase.adminClient
        .from('appointments')
        .select('id', { count: 'exact', head: true })
        .eq('org_id', orgId)
        .eq('assigned_to', agentId)
        .eq('appointment_type_id', type.id)
        .in('status', ['scheduled', 'confirmed'])
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString());
      if ((count ?? 0) >= type.max_per_day) {
        throw new ConflictException(
          `Limite de ${type.max_per_day}/dia para "${type.name}" atingido pra esse agente`,
        );
      }
    }
  }

  private async resolveAgents(
    orgId: string,
    agentId?: string,
  ): Promise<Array<{ id: string; display_name: string | null }>> {
    if (agentId) {
      const { data } = await this.supabase.adminClient
        .from('org_members')
        .select('id, display_name')
        .eq('org_id', orgId)
        .eq('id', agentId)
        .maybeSingle();
      const m = data as { id: string; display_name: string | null } | null;
      return m ? [m] : [];
    }
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('id, display_name')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin', 'agent']);
    return ((data ?? []) as Array<{ id: string; display_name: string | null }>);
  }

  private async resolveMemberId(orgId: string, userId: string): Promise<string | null> {
    const { data } = await this.supabase.adminClient
      .from('org_members')
      .select('id')
      .eq('org_id', orgId)
      .eq('user_id', userId)
      .maybeSingle();
    return ((data as { id: string } | null)?.id) ?? null;
  }

  private async fetchOrgBusinessHoursForDate(
    orgId: string,
    date: Date,
  ): Promise<TimeRange | null> {
    const { data } = await this.supabase.adminClient
      .from('organizations')
      .select('business_hours')
      .eq('id', orgId)
      .maybeSingle();
    const bh = (data as { business_hours: Record<string, unknown> | null } | null)?.business_hours;
    if (!bh || (bh as { enabled?: boolean }).enabled === false) {
      // Default: 9h-18h
      return this.timeRangeForDate(date, '09:00', '18:00');
    }
    const schedule = (bh as { schedule?: Record<string, { start?: string; end?: string; enabled?: boolean }> }).schedule;
    if (!schedule) return this.timeRangeForDate(date, '09:00', '18:00');

    const dayKeys: Array<keyof NonNullable<typeof schedule>> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    const dayKey = dayKeys[date.getDay()];
    const day = dayKey ? schedule[dayKey] : undefined;
    if (!day || day.enabled === false || !day.start || !day.end) return null;
    return this.timeRangeForDate(date, day.start, day.end);
  }

  private async resolveAgentWindow(
    orgId: string,
    agentId: string,
    date: Date,
    orgWindow: TimeRange | null,
  ): Promise<TimeRange[]> {
    const dateStr = date.toISOString().slice(0, 10);

    // 1. Override pra data específica?
    const { data: override } = await this.supabase.adminClient
      .from('agent_availability')
      .select('*')
      .eq('org_id', orgId)
      .eq('agent_id', agentId)
      .eq('specific_date', dateStr)
      .maybeSingle();
    if (override) {
      const o = override as { is_available: boolean; start_time: string; end_time: string };
      if (!o.is_available) return [];
      return [this.timeRangeForDate(date, o.start_time, o.end_time)];
    }

    // 2. Schedule semanal
    const dow = date.getDay();
    const { data: weekly } = await this.supabase.adminClient
      .from('agent_availability')
      .select('*')
      .eq('org_id', orgId)
      .eq('agent_id', agentId)
      .eq('day_of_week', dow);
    const weeklyRows = ((weekly ?? []) as Array<{
      is_available: boolean;
      start_time: string;
      end_time: string;
    }>).filter((r) => r.is_available);

    if (weeklyRows.length > 0) {
      return weeklyRows.map((r) => this.timeRangeForDate(date, r.start_time, r.end_time));
    }

    // 3. Fallback: business_hours da org
    return orgWindow ? [orgWindow] : [];
  }

  private timeRangeForDate(date: Date, startHHMM: string, endHHMM: string): TimeRange {
    const [sh = 0, sm = 0] = startHHMM.split(':').map(Number);
    const [eh = 23, em = 59] = endHHMM.split(':').map(Number);
    const start = new Date(date);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(date);
    end.setHours(eh, em, 0, 0);
    return { start, end };
  }

  private async fetchBusyRanges(
    orgId: string,
    agentId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<TimeRange[]> {
    const [appts, tasks, googleBusy] = await Promise.all([
      this.supabase.adminClient
        .from('appointments')
        .select('start_time, end_time')
        .eq('org_id', orgId)
        .eq('assigned_to', agentId)
        .in('status', ['scheduled', 'confirmed'])
        .gte('start_time', dayStart.toISOString())
        .lte('start_time', dayEnd.toISOString()),
      this.supabase.adminClient
        .from('tasks')
        .select('due_date')
        .eq('org_id', orgId)
        .eq('assigned_to', agentId)
        .in('status', ['pending', 'in_progress'])
        .gte('due_date', dayStart.toISOString())
        .lte('due_date', dayEnd.toISOString()),
      this.fetchGoogleBusy(orgId, agentId, dayStart, dayEnd),
    ]);

    const out: TimeRange[] = [];
    for (const a of (appts.data ?? []) as Array<{ start_time: string; end_time: string }>) {
      out.push({ start: new Date(a.start_time), end: new Date(a.end_time) });
    }
    for (const t of (tasks.data ?? []) as Array<{ due_date: string | null }>) {
      if (!t.due_date) continue;
      const d = new Date(t.due_date);
      // Tasks bloqueiam 30min ao redor do due_date
      out.push({ start: new Date(d.getTime() - 15 * 60_000), end: new Date(d.getTime() + 15 * 60_000) });
    }
    for (const g of googleBusy) {
      out.push({ start: new Date(g.start), end: new Date(g.end) });
    }
    return out;
  }

  /**
   * Consulta Google Calendar freeBusy quando o agente tem integração ativa
   * com `consider_personal_events=true`. Best-effort: se falha, retorna [].
   */
  private async fetchGoogleBusy(
    orgId: string,
    agentId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Array<{ start: string; end: string }>> {
    try {
      const integration = await this.integrations.findActiveForAgent(orgId, agentId, 'google');
      if (!integration || !integration.consider_personal_events || !integration.calendar_id) {
        return [];
      }
      return await this.google.getBusyRanges(
        integration.id,
        integration.calendar_id,
        dayStart.toISOString(),
        dayEnd.toISOString(),
      );
    } catch (err) {
      this.logger.warn(
        `fetchGoogleBusy falhou (não-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }

  private generateSlots(
    window: TimeRange,
    durationMinutes: number,
    bufferMinutes: number,
    busy: TimeRange[],
    minStartTime: Date,
  ): TimeRange[] {
    const out: TimeRange[] = [];
    const stepMs = 15 * 60_000; // gera em grade de 15min
    const durationMs = durationMinutes * 60_000;
    const bufferMs = bufferMinutes * 60_000;
    const sortedBusy = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());

    let cursor = window.start.getTime();
    const winEnd = window.end.getTime();

    while (cursor + durationMs <= winEnd) {
      const slotStart = new Date(cursor);
      const slotEnd = new Date(cursor + durationMs);
      if (slotStart < minStartTime) {
        cursor += stepMs;
        continue;
      }

      // Conflita com algum busy (com buffer)?
      const conflicts = sortedBusy.some((b) => {
        const bStart = b.start.getTime() - bufferMs;
        const bEnd = b.end.getTime() + bufferMs;
        return cursor < bEnd && cursor + durationMs > bStart;
      });

      if (!conflicts) {
        out.push({ start: slotStart, end: slotEnd });
      }
      cursor += stepMs;
    }

    return out;
  }
}
