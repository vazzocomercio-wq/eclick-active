import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BridgeService } from '../bridge/bridge.service';
import { SacSlaService } from './sac-sla.service';
import { EventsGateway } from '../../gateways/events.gateway';
import type {
  SacTicketEventPayload,
  EventName,
  EventPayloadMap,
} from '../../gateways/events.gateway';
import type {
  SacTicket,
  SacTicketAction,
  SacListFilters,
  SacDashboardCounts,
  SacAiClassification,
} from './sac.types';
import type { CreateTicketDto } from './dto/create-ticket.dto';
import type {
  UpdateTicketDto,
  AssignTicketDto,
  EscalateTicketDto,
} from './dto/update-ticket.dto';
import type {
  ResolveTicketDto,
  ReopenTicketDto,
  RateTicketDto,
  AddNoteDto,
  LinkOrderDto,
} from './dto/resolve-ticket.dto';

interface ContactSnapshot {
  id: string;
  org_id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

@Injectable()
export class SacTicketsService {
  private readonly log = new Logger(SacTicketsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly bridge: BridgeService,
    private readonly sla: SacSlaService,
    private readonly events: EventsGateway,
  ) {}

  // ─── CRUD básico ──────────────────────────────────

  async create(
    orgId: string,
    dto: CreateTicketDto,
    actorId: string | null = null,
  ): Promise<SacTicket> {
    let contactId = dto.contact_id;
    let sourceChannel = dto.source_channel ?? null;

    // Se conversation_id fornecido sem contact_id, puxa contato e canal
    if (dto.conversation_id) {
      const { data: conv } = await this.supabase.adminClient
        .from('conversations')
        .select('contact_id, channel_type')
        .eq('id', dto.conversation_id)
        .eq('org_id', orgId)
        .maybeSingle();
      if (conv) {
        contactId = contactId || (conv as { contact_id: string }).contact_id;
        sourceChannel = sourceChannel || (conv as { channel_type: string }).channel_type;
      }
    }

    if (!contactId) {
      throw new BadRequestException('contact_id é obrigatório');
    }

    const priority = dto.priority ?? 'normal';
    const category = dto.category ?? 'general';

    // Calcula deadline SLA
    const deadlines = await this.sla.calculateDeadline(orgId, {
      priority,
      category,
      channel_type: sourceChannel,
    });

    // Tenta auto-vincular pedido via bridge
    const orderFields = await this.tryAutoLinkOrder(orgId, contactId);

    const insertPayload = {
      org_id: orgId,
      contact_id: contactId,
      conversation_id: dto.conversation_id ?? null,
      category,
      subcategory: dto.subcategory ?? null,
      priority,
      department: dto.department ?? null,
      source_channel: sourceChannel,
      tags: dto.tags ?? [],
      metadata: dto.metadata ?? {},
      sla_deadline_at: deadlines.resolution_at.toISOString(),
      ...orderFields,
    };

    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .insert(insertPayload)
      .select('*')
      .single();
    if (error) throw error;

    const ticket = data as SacTicket;
    this.emit(orgId, 'sac:ticket-created', { ticket });
    if (actorId) {
      this.log.debug(`Ticket #${ticket.ticket_number} criado por ${actorId}`);
    }
    return ticket;
  }

  /** Cria ticket a partir de conversa + classificação IA. */
  async createFromConversation(
    orgId: string,
    conversationId: string,
    classification: SacAiClassification,
  ): Promise<SacTicket> {
    const { data: conv } = await this.supabase.adminClient
      .from('conversations')
      .select('contact_id, channel_type')
      .eq('id', conversationId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!conv) throw new NotFoundException('Conversa não encontrada');

    const contactId = (conv as { contact_id: string }).contact_id;
    const channelType = (conv as { channel_type: string }).channel_type;

    const deadlines = await this.sla.calculateDeadline(orgId, {
      priority: classification.priority,
      category: classification.category,
      channel_type: channelType,
    });

    const orderFields = await this.tryAutoLinkOrder(orgId, contactId);

    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        conversation_id: conversationId,
        category: classification.category,
        subcategory: classification.subcategory ?? null,
        priority: classification.priority,
        reputation_risk_level: classification.reputation_risk,
        source_channel: channelType,
        sla_deadline_at: deadlines.resolution_at.toISOString(),
        ai_category: classification.category,
        ai_priority: classification.priority,
        ai_sentiment: classification.sentiment,
        ai_risk_score: classification.risk_score,
        ai_summary: classification.summary,
        ai_resolution_suggestion: classification.resolution_suggestion,
        ai_suggested_response: classification.suggested_response,
        ai_classified_at: new Date().toISOString(),
        created_by_ai: true,
        ...orderFields,
      })
      .select('*')
      .single();
    if (error) throw error;

    const ticket = data as SacTicket;
    this.emit(orgId, 'sac:ticket-created', { ticket, source: 'ai' });
    return ticket;
  }

  /** Cria ticket preventivo (delivery_delay) sem conversa. */
  async createPreventive(
    orgId: string,
    contactId: string,
    orderData: {
      marketplace?: string | null;
      marketplace_id?: string | null;
      tracking?: string | null;
      value?: number | null;
      status?: string | null;
      raw?: Record<string, unknown>;
    },
    daysDelayed: number,
  ): Promise<SacTicket> {
    const summary = `Pedido atrasado ${daysDelayed} dia(s) — contato preventivo recomendado`;
    const deadlines = await this.sla.calculateDeadline(orgId, {
      priority: 'high',
      category: 'delivery_delay',
    });
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .insert({
        org_id: orgId,
        contact_id: contactId,
        category: 'delivery_delay',
        priority: 'high',
        is_preventive: true,
        created_by_ai: true,
        ai_summary: summary,
        order_marketplace: orderData.marketplace ?? null,
        order_marketplace_id: orderData.marketplace_id ?? null,
        order_tracking: orderData.tracking ?? null,
        order_value: orderData.value ?? null,
        order_status: orderData.status ?? null,
        order_data: orderData.raw ?? {},
        sla_deadline_at: deadlines.resolution_at.toISOString(),
      })
      .select('*')
      .single();
    if (error) throw error;
    const ticket = data as SacTicket;
    this.emit(orgId, 'sac:preventive-created', { ticket });
    return ticket;
  }

  async findAll(
    orgId: string,
    filters: SacListFilters = {},
  ): Promise<{ rows: SacTicket[]; total: number }> {
    const page = filters.page ?? 1;
    const pageSize = Math.min(filters.page_size ?? 25, 100);
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let q = this.supabase.adminClient
      .from('sac_tickets')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId);

    if (filters.status) {
      const arr = Array.isArray(filters.status) ? filters.status : [filters.status];
      q = q.in('status', arr);
    }
    if (filters.priority) {
      const arr = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
      q = q.in('priority', arr);
    }
    if (filters.category) {
      const arr = Array.isArray(filters.category) ? filters.category : [filters.category];
      q = q.in('category', arr);
    }
    if (filters.assigned_to) q = q.eq('assigned_to', filters.assigned_to);
    if (filters.sla_breached !== undefined) q = q.eq('sla_breached', filters.sla_breached);
    if (filters.is_preventive !== undefined) q = q.eq('is_preventive', filters.is_preventive);
    if (filters.channel_type) q = q.eq('source_channel', filters.channel_type);
    if (filters.has_order === true) q = q.not('order_marketplace_id', 'is', null);
    if (filters.has_order === false) q = q.is('order_marketplace_id', null);
    if (filters.reputation_risk_min) {
      const order: Record<string, number> = {
        none: 0, low: 1, medium: 2, high: 3, critical: 4,
      };
      const min = order[filters.reputation_risk_min];
      const allowed = Object.keys(order).filter((k) => order[k] >= min);
      q = q.in('reputation_risk_level', allowed);
    }
    if (filters.date_from) q = q.gte('created_at', filters.date_from);
    if (filters.date_to) q = q.lte('created_at', filters.date_to);

    if (filters.search && filters.search.trim()) {
      const s = filters.search.trim();
      const asNum = Number(s.replace(/^#/, ''));
      if (Number.isFinite(asNum)) {
        q = q.eq('ticket_number', asNum);
      } else {
        // Busca em ai_summary OU contato (via contact_id já filtra antes — não fazemos join aqui pra simplicidade)
        q = q.ilike('ai_summary', `%${s}%`);
      }
    }

    q = q
      .order('priority', { ascending: false })
      .order('sla_deadline_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(from, to);

    const { data, error, count } = await q;
    if (error) throw error;
    return {
      rows: (data ?? []) as SacTicket[],
      total: count ?? 0,
    };
  }

  async findById(orgId: string, id: string): Promise<SacTicket> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new NotFoundException('Ticket não encontrado');
    return data as SacTicket;
  }

  async findOpenByConversation(
    orgId: string,
    conversationId: string,
  ): Promise<SacTicket | null> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .select('*')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .not('status', 'in', '("resolved","cancelled")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      this.log.warn(`findOpenByConversation: ${String(error.message)}`);
      return null;
    }
    return (data as SacTicket | null) ?? null;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateTicketDto,
  ): Promise<SacTicket> {
    // Auto-promover status="new" → "in_progress" quando algum agente toca o ticket
    const patch: Record<string, unknown> = { ...dto };
    if (dto.status === undefined && dto.assigned_to !== undefined) {
      const current = await this.findById(orgId, id);
      if (current.status === 'new') patch.status = 'in_progress';
      if (!current.first_response_at) {
        patch.first_response_at = new Date().toISOString();
        patch.sla_first_response_at = new Date().toISOString();
      }
    }
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const ticket = data as SacTicket;
    this.emit(orgId, 'sac:ticket-updated', { ticket });
    return ticket;
  }

  async assign(
    orgId: string,
    id: string,
    dto: AssignTicketDto,
  ): Promise<SacTicket> {
    return this.update(orgId, id, { assigned_to: dto.agent_id });
  }

  async escalate(
    orgId: string,
    id: string,
    dto: EscalateTicketDto,
  ): Promise<SacTicket> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .update({
        escalated_to: dto.to_agent_id,
        priority: 'high',
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const ticket = data as SacTicket;
    if (dto.reason) {
      await this.addNote(orgId, id, { content: `Escalado: ${dto.reason}` }, null);
    }
    this.emit(orgId, 'sac:ticket-escalated', { ticket, reason: dto.reason });
    return ticket;
  }

  async resolve(
    orgId: string,
    id: string,
    dto: ResolveTicketDto,
  ): Promise<SacTicket> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .update({
        status: 'resolved',
        resolution_type: dto.resolution_type,
        resolution_notes: dto.resolution_notes ?? null,
        resolved_at: now,
        sla_resolved_at: now,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const ticket = data as SacTicket;
    this.emit(orgId, 'sac:ticket-resolved', { ticket });
    return ticket;
  }

  async reopen(
    orgId: string,
    id: string,
    dto: ReopenTicketDto,
  ): Promise<SacTicket> {
    const ticket = await this.findById(orgId, id);
    const deadlines = await this.sla.calculateDeadline(orgId, {
      priority: ticket.priority,
      category: ticket.category,
      channel_type: ticket.source_channel,
    });
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .update({
        status: 'reopened',
        reopened_at: new Date().toISOString(),
        resolved_at: null,
        sla_resolved_at: null,
        sla_deadline_at: deadlines.resolution_at.toISOString(),
        sla_breached: false,
      })
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    const updated = data as SacTicket;
    if (dto.reason) {
      await this.addNote(orgId, id, { content: `Reabertura: ${dto.reason}` }, null);
    }
    this.emit(orgId, 'sac:ticket-reopened', { ticket: updated });
    return updated;
  }

  async addNote(
    orgId: string,
    ticketId: string,
    dto: AddNoteDto,
    actorId: string | null,
  ): Promise<SacTicketAction> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_ticket_actions')
      .insert({
        ticket_id: ticketId,
        org_id: orgId,
        action_type: 'note_added',
        actor_type: actorId ? 'agent' : 'system',
        actor_id: actorId,
        description: dto.content,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as SacTicketAction;
  }

  async linkOrder(
    orgId: string,
    ticketId: string,
    dto: LinkOrderDto,
  ): Promise<SacTicket> {
    const order = await this.bridge.getOrderByQuery(orgId, dto.query);
    if (!order) {
      throw new NotFoundException('Pedido não encontrado no SaaS');
    }
    return this.update(orgId, ticketId, {} as UpdateTicketDto).then(async () => {
      const { data, error } = await this.supabase.adminClient
        .from('sac_tickets')
        .update({
          order_id: order.id,
          order_marketplace: order.marketplace,
          order_marketplace_id: order.marketplace_order_id,
          order_status: order.shipping_status,
          order_tracking: order.shipping_tracking_number,
          order_value: order.total_amount,
          order_data: order as unknown as Record<string, unknown>,
        })
        .eq('id', ticketId)
        .eq('org_id', orgId)
        .select('*')
        .single();
      if (error) throw error;
      return data as SacTicket;
    });
  }

  async rateSatisfaction(
    orgId: string,
    ticketId: string,
    dto: RateTicketDto,
  ): Promise<SacTicket> {
    const ticket = await this.findById(orgId, ticketId);
    if (ticket.status !== 'resolved') {
      throw new BadRequestException(
        'Apenas tickets resolvidos podem ser avaliados',
      );
    }
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .update({ customer_satisfaction: dto.rating })
      .eq('id', ticketId)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SacTicket;
  }

  async getActions(
    orgId: string,
    ticketId: string,
  ): Promise<SacTicketAction[]> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_ticket_actions')
      .select('*')
      .eq('org_id', orgId)
      .eq('ticket_id', ticketId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []) as SacTicketAction[];
  }

  async getByContact(
    orgId: string,
    contactId: string,
  ): Promise<SacTicket[]> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_tickets')
      .select('*')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SacTicket[];
  }

  async getByConversation(
    orgId: string,
    conversationId: string,
  ): Promise<SacTicket | null> {
    return this.findOpenByConversation(orgId, conversationId);
  }

  async getDashboardCounts(orgId: string): Promise<SacDashboardCounts> {
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'sac_dashboard_counts',
        { p_org_id: orgId },
      );
      if (error) throw error;
      return (data ?? this.emptyCounts()) as SacDashboardCounts;
    } catch (err) {
      this.log.warn(`getDashboardCounts falhou: ${String(err)}`);
      return this.emptyCounts();
    }
  }

  // ─── helpers internos ─────────────────────────────

  private async tryAutoLinkOrder(
    orgId: string,
    contactId: string,
  ): Promise<Record<string, unknown>> {
    if (!(await this.bridge.hasSaasIntegration(orgId))) return {};
    const contact = await this.fetchContact(orgId, contactId);
    if (!contact) return {};
    const orders = await this.bridge.getOrdersByContact(orgId, {
      phone: contact.phone,
      email: contact.email,
      limit: 1,
    });
    if (orders.length === 0) return {};
    const o = orders[0];
    return {
      order_id: o.id,
      order_marketplace: o.marketplace,
      order_marketplace_id: o.marketplace_order_id,
      order_status: o.shipping_status,
      order_tracking: o.shipping_tracking_number,
      order_value: o.total_amount,
      order_data: o as unknown as Record<string, unknown>,
    };
  }

  private async fetchContact(
    orgId: string,
    contactId: string,
  ): Promise<ContactSnapshot | null> {
    const { data } = await this.supabase.adminClient
      .from('contacts')
      .select('id, org_id, full_name, phone, email')
      .eq('id', contactId)
      .eq('org_id', orgId)
      .maybeSingle();
    return (data as ContactSnapshot | null) ?? null;
  }

  private emptyCounts(): SacDashboardCounts {
    return {
      new: 0,
      in_progress: 0,
      waiting_customer: 0,
      waiting_internal: 0,
      resolved: 0,
      critical: 0,
      sla_due_soon: 0,
      sla_breached: 0,
      reputation_risk: 0,
      resolved_today: 0,
      total_open: 0,
    };
  }

  private emit<E extends EventName>(
    orgId: string,
    event: E,
    payload: EventPayloadMap[E],
  ): void {
    try {
      this.events.emitToOrg(orgId, event, payload);
    } catch (err) {
      this.log.warn(`emit ${event} falhou: ${String(err)}`);
    }
  }
}
