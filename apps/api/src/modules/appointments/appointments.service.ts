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
  AppointmentCustomField,
  AppointmentDetail,
  AppointmentType,
  AvailabilitySlot,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { getOrgTimezone } from '../../common/org-settings.helper';
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
    private readonly dispatcher: ChannelDispatcherService,
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

    let validatedCustomFields: Record<string, unknown> | null = null;
    if (dto.appointment_type_id) {
      const type = await this.types.findById(orgId, dto.appointment_type_id);
      await this.assertWithinTypeRules(orgId, type, start, dto.assigned_to);
      validatedCustomFields = this.validateCustomFields(
        type.custom_fields_schema ?? [],
        dto.custom_fields ?? {},
      );
    }

    // Mescla custom_fields validados em metadata.custom_fields. Mantém
    // resto da metadata (source, etc.) intacto.
    const baseMetadata = dto.metadata ?? {};
    const finalMetadata =
      validatedCustomFields !== null
        ? { ...baseMetadata, custom_fields: validatedCustomFields }
        : baseMetadata;

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
        metadata: finalMetadata,
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
   * Manda lembrete de appointment via WhatsApp pro contato. Texto é
   * gerado em pt-BR no timezone da org (organizations.settings.timezone).
   *
   *   - kind='24h' → "Oi! Lembrete: amanhã às HH:mm temos seu agendamento (X)"
   *   - kind='1h'  → "Olá! Faltam 1h pro seu agendamento (X) às HH:mm"
   *
   * Best-effort. Se contato não tem conversa/canal, só loga e segue.
   */
  async sendAppointmentReminder(
    appointment: AppointmentDetail,
    kind: '24h' | '1h',
  ): Promise<void> {
    if (!appointment.contact_id) {
      this.logger.debug(
        `reminder ${kind}: appt ${appointment.id} sem contact_id — skip`,
      );
      return;
    }

    // Procura conversa associada — preferência pra a do agendamento, senão
    // qualquer conversa ativa do contato com canal whatsapp.
    let conversationId: string | null = appointment.conversation_id;
    let channelId: string | null = null;

    if (conversationId) {
      const { data } = await this.supabase.adminClient
        .from('conversations')
        .select('channel_id')
        .eq('org_id', appointment.org_id)
        .eq('id', conversationId)
        .maybeSingle();
      channelId = (data as { channel_id: string | null } | null)?.channel_id ?? null;
    }

    if (!channelId) {
      // Fallback: busca conversa mais recente do contato com canal
      const { data } = await this.supabase.adminClient
        .from('conversations')
        .select('id, channel_id')
        .eq('org_id', appointment.org_id)
        .eq('contact_id', appointment.contact_id)
        .not('channel_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const c = data as { id: string; channel_id: string | null } | null;
      if (c?.channel_id) {
        conversationId = c.id;
        channelId = c.channel_id;
      }
    }

    if (!channelId || !conversationId) {
      this.logger.debug(
        `reminder ${kind}: appt ${appointment.id} sem canal/conversa — skip`,
      );
      return;
    }

    // Formata timestamp no tz da org
    const tz = await getOrgTimezone(this.supabase.adminClient, appointment.org_id);
    const dayFmt = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      timeZone: tz,
    });
    const timeFmt = new Intl.DateTimeFormat('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    });
    const start = new Date(appointment.start_time);
    const dayLabel = dayFmt.format(start);
    const timeLabel = timeFmt.format(start);

    const agentSuffix = appointment.agent?.display_name
      ? ` com ${appointment.agent.display_name}`
      : '';
    const titleSuffix = appointment.title ? ` (${appointment.title})` : '';

    const text =
      kind === '24h'
        ? `Oi! 📅 Passando pra te lembrar do seu agendamento amanhã, ${dayLabel} às ${timeLabel}${agentSuffix}${titleSuffix}. Caso precise reagendar, é só me responder por aqui!`
        : `Olá! ⏰ Faltam só 1 hora pro seu agendamento de hoje às ${timeLabel}${agentSuffix}${titleSuffix}. Te esperamos!`;

    // Persiste msg outbound + dispatch (best-effort)
    const { data: persisted, error: persistErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: appointment.org_id,
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: 'system',
        content_type: 'text',
        content: { body: text },
        plain_text: text,
        status: 'pending',
        metadata: {
          source: 'appointment_reminder',
          appointment_id: appointment.id,
          reminder_kind: kind,
        },
      })
      .select('id, created_at')
      .single();

    if (persistErr || !persisted) {
      this.logger.warn(
        `reminder ${kind}: persist falhou: ${persistErr?.message ?? 'sem dados'}`,
      );
      return;
    }
    const { id: messageId, created_at: messageCreatedAt } = persisted as {
      id: string;
      created_at: string;
    };

    try {
      const result = await this.dispatcher.send({
        org_id: appointment.org_id,
        channel_id: channelId,
        contact_id: appointment.contact_id,
        content_type: 'text',
        content: { body: text },
      });
      await this.supabase.adminClient
        .from('messages')
        .update({
          status: 'sent',
          channel_message_id: result.channel_message_id,
        })
        .eq('org_id', appointment.org_id)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
      this.logger.log(
        `reminder ${kind} enviado appt=${appointment.id} contact=${appointment.contact_id}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`reminder ${kind} dispatch falhou: ${msg}`);
      await this.supabase.adminClient
        .from('messages')
        .update({
          status: 'failed',
          error_code: 'reminder_dispatch_error',
          error_message: msg,
        })
        .eq('org_id', appointment.org_id)
        .eq('id', messageId)
        .eq('created_at', messageCreatedAt);
    }
  }

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

  // ──────────────────────────────────────────────────────────
  // Custom fields — valida valores contra o schema do appointment_type
  // ──────────────────────────────────────────────────────────

  /**
   * Valida `values` (key→value) contra o schema do appointment_type.
   *   - Campos `required` precisam estar presentes e não-vazios
   *   - Tipos coercivos (number, boolean, date) viram valores tipados
   *   - select valida options
   *   - text/textarea respeita max_length
   * Lança BadRequestException com lista de erros consolidada.
   * Retorna objeto saneado pra persistir em appointment.metadata.custom_fields.
   */
  private validateCustomFields(
    schema: AppointmentCustomField[],
    values: Record<string, unknown>,
  ): Record<string, unknown> {
    if (!Array.isArray(schema) || schema.length === 0) {
      // Schema vazio — permite metadata arbitrária mas não a inclui.
      return {};
    }

    const errors: string[] = [];
    const out: Record<string, unknown> = {};
    const seen = new Set<string>();

    for (const field of schema) {
      seen.add(field.key);
      const raw = values[field.key];
      const isEmpty =
        raw === undefined ||
        raw === null ||
        (typeof raw === 'string' && raw.trim() === '');

      if (isEmpty) {
        if (field.required) {
          errors.push(`Campo "${field.label}" é obrigatório`);
        }
        continue;
      }

      switch (field.type) {
        case 'text':
        case 'textarea': {
          if (typeof raw !== 'string') {
            errors.push(`"${field.label}" deve ser texto`);
            break;
          }
          if (field.max_length && raw.length > field.max_length) {
            errors.push(
              `"${field.label}" excede ${field.max_length} caracteres`,
            );
            break;
          }
          out[field.key] = raw;
          break;
        }
        case 'number': {
          const n = typeof raw === 'number' ? raw : Number(raw);
          if (!Number.isFinite(n)) {
            errors.push(`"${field.label}" deve ser número`);
            break;
          }
          if (field.min !== undefined && n < field.min) {
            errors.push(`"${field.label}" mínimo ${field.min}`);
            break;
          }
          if (field.max !== undefined && n > field.max) {
            errors.push(`"${field.label}" máximo ${field.max}`);
            break;
          }
          out[field.key] = n;
          break;
        }
        case 'select': {
          if (typeof raw !== 'string') {
            errors.push(`"${field.label}" deve ser string`);
            break;
          }
          if (
            !Array.isArray(field.options) ||
            !field.options.includes(raw)
          ) {
            errors.push(
              `"${field.label}" deve ser uma das opções: ${field.options?.join(', ') ?? '(nenhuma)'}`,
            );
            break;
          }
          out[field.key] = raw;
          break;
        }
        case 'date': {
          if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            errors.push(`"${field.label}" deve ser data YYYY-MM-DD`);
            break;
          }
          out[field.key] = raw;
          break;
        }
        case 'boolean': {
          if (typeof raw === 'boolean') {
            out[field.key] = raw;
          } else if (raw === 'true' || raw === 'false') {
            out[field.key] = raw === 'true';
          } else {
            errors.push(`"${field.label}" deve ser true/false`);
          }
          break;
        }
      }
    }

    // Avisa sobre keys extras (não derruba — só ignora silenciosamente)
    // pra não bloquear se schema mudou após criação.
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validação de custom_fields falhou',
        errors,
      });
    }

    return out;
  }

  // ──────────────────────────────────────────────────────────
  // findSlotsForOrg — usado pelo Concierge IA pra propor horários
  // ──────────────────────────────────────────────────────────

  /**
   * Encontra slots disponíveis na org inteira pra propor pro lead via
   * Concierge. Diferente de `getAvailableSlots`:
   *
   *   - Filtra agentes por `specialty` (GIN array overlap em
   *     org_members.specialties) quando fornecida.
   *   - Cada agente usa SEU PRÓPRIO `default_duration_minutes` +
   *     `default_buffer_minutes` (não depende de appointment_type).
   *     Fallback `fallbackDurationMinutes` quando agent não configurou.
   *   - Itera por `daysAhead` dias (default 7).
   *   - Cap em `limit` slots (default 12) — Concierge geralmente vai
   *     mostrar só os 3 primeiros.
   *
   * Retorna lista achatada e ordenada por start_time.
   */
  async findSlotsForOrg(
    orgId: string,
    opts: {
      specialty?: string;
      daysAhead?: number;
      limit?: number;
      fallbackDurationMinutes?: number;
      minAdvanceHours?: number;
    } = {},
  ): Promise<AvailabilitySlot[]> {
    const daysAhead = Math.max(1, Math.min(opts.daysAhead ?? 7, 30));
    const limit = Math.max(1, Math.min(opts.limit ?? 12, 100));
    const fallbackDuration = opts.fallbackDurationMinutes ?? 30;
    const minAdvanceHours = opts.minAdvanceHours ?? 2;
    const minStartTime = new Date(Date.now() + minAdvanceHours * 60 * 60 * 1000);

    // 1. Lista candidatos — filtra por specialty se fornecida (GIN array
    //    overlap via PostgREST `cs` operator → Postgres `@>`/`&&`).
    let q = this.supabase.adminClient
      .from('org_members')
      .select('id, display_name, specialties, default_duration_minutes, default_buffer_minutes')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .in('role', ['owner', 'admin', 'agent']);

    if (opts.specialty) {
      // Normaliza a busca pra lower-case-trim. Como specialties é text[] e
      // não temos índice case-insensitive, aplicamos overlap direto. Se
      // quiser flexibilidade extra, dá pra fazer match em JS após o fetch.
      q = q.contains('specialties', [opts.specialty]);
    }

    const { data: agentsRaw, error } = await q;
    if (error) {
      this.logger.warn(`findSlotsForOrg query agents falhou: ${error.message}`);
      return [];
    }

    let agents = (agentsRaw ?? []) as Array<{
      id: string;
      display_name: string | null;
      specialties: string[];
      default_duration_minutes: number | null;
      default_buffer_minutes: number;
    }>;

    // Fallback: se filtro por specialty não retornou ninguém, tenta sem
    //   specialty pra ainda propor algo (evita Concierge ficar mudo).
    let specialtyMatched = agents.length > 0;
    if (opts.specialty && agents.length === 0) {
      const { data: allAgents } = await this.supabase.adminClient
        .from('org_members')
        .select('id, display_name, specialties, default_duration_minutes, default_buffer_minutes')
        .eq('org_id', orgId)
        .eq('status', 'active')
        .in('role', ['owner', 'admin', 'agent']);
      agents = (allAgents ?? []) as typeof agents;
      specialtyMatched = false;
      this.logger.log(
        `findSlotsForOrg: specialty="${opts.specialty}" sem match — fallback pra todos os agentes (${agents.length})`,
      );
    }

    if (agents.length === 0) return [];

    // 2. Janela base por org (business_hours) — usado como fallback quando
    //    agente não tem agent_availability nenhum (override ou semanal).
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const out: AvailabilitySlot[] = [];

    // Itera dias (hoje incluído pra slots ainda válidos pelo minStartTime)
    for (let d = 0; d < daysAhead; d++) {
      const day = new Date(today);
      day.setDate(today.getDate() + d);

      const dayStart = new Date(day);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(day);
      dayEnd.setHours(23, 59, 59, 999);

      const orgWindow = await this.fetchOrgBusinessHoursForDate(orgId, dayStart);

      for (const agent of agents) {
        const duration = agent.default_duration_minutes ?? fallbackDuration;
        const buffer = agent.default_buffer_minutes ?? 0;

        const windows = await this.resolveAgentWindow(orgId, agent.id, dayStart, orgWindow);
        if (windows.length === 0) continue;

        const busy = await this.fetchBusyRanges(orgId, agent.id, dayStart, dayEnd);

        for (const win of windows) {
          const winSlots = this.generateSlots(win, duration, buffer, busy, minStartTime);
          for (const s of winSlots) {
            out.push({
              start_time: s.start.toISOString(),
              end_time: s.end.toISOString(),
              agent_id: agent.id,
              agent_name: agent.display_name,
              duration_minutes: duration,
              agent_specialties: specialtyMatched ? agent.specialties : [],
            });
            if (out.length >= limit * 3) break; // cap intermediário antes do sort final
          }
          if (out.length >= limit * 3) break;
        }
        if (out.length >= limit * 3) break;
      }
      if (out.length >= limit * 3) break;
    }

    return out
      .sort((a, b) => a.start_time.localeCompare(b.start_time))
      .slice(0, limit);
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
