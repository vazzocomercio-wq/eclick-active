import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Contact,
  ContactTimelineEventType,
  Deal,
  Json,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { OutboundWebhookService } from '../webhooks/outbound/outbound-webhook.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ListContactsQueryDto } from './dto/list-contacts.query.dto';

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

@Injectable()
export class ContactsService {
  private readonly logger = new Logger(ContactsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooks: OutboundWebhookService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateContactDto): Promise<Contact> {
    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .insert({ org_id: orgId, ...dto })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to create contact');
    }
    const contact = data as Contact;
    void this.webhooks.deliver(orgId, 'contact.created', contact as unknown as Record<string, unknown>);
    return contact;
  }

  // ──────────────────────────────────────────────────────────
  // FIND ALL (paginado + filtros)
  // ──────────────────────────────────────────────────────────

  async findAll(orgId: string, filters: ListContactsQueryDto): Promise<PaginatedResult<Contact>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('contacts')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (filters.temperature) {
      q = q.eq('temperature', filters.temperature);
    }

    if (filters.tags && filters.tags.length > 0) {
      // Operador `cs` (contains) em arrays: contato precisa ter TODAS as tags listadas
      q = q.contains('tags', filters.tags);
    }

    if (filters.search) {
      const escaped = this.escapeIlike(filters.search);
      // Combina ilike em name/phone/email. NÃO usa o índice GIN tsvector
      // (esse precisa de RPC dedicada — ver método `search()`).
      q = q.or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      );
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as Contact[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY ID
  // ──────────────────────────────────────────────────────────

  async findById(orgId: string, id: string): Promise<Contact> {
    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`Contact ${id} not found`);
    }
    return data as Contact;
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY PHONE (helpers de inbound)
  // ──────────────────────────────────────────────────────────

  async findByPhone(orgId: string, phone: string): Promise<Contact | null> {
    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .select('*')
      .eq('org_id', orgId)
      .eq('phone', phone)
      .maybeSingle();

    if (error) {
      this.logger.error(`findByPhone failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data as Contact | null) ?? null;
  }

  async findOrCreateByPhone(
    orgId: string,
    phone: string,
    name?: string,
  ): Promise<Contact> {
    const existing = await this.findByPhone(orgId, phone);
    if (existing) return existing;

    return this.create(orgId, {
      phone,
      name,
      source: 'whatsapp',
    });
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────

  async update(orgId: string, id: string, dto: UpdateContactDto): Promise<Contact> {
    // Garante que o contato existe e pertence à org antes de atualizar
    await this.findById(orgId, id);

    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .update(dto)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to update contact');
    }
    return data as Contact;
  }

  // ──────────────────────────────────────────────────────────
  // DELETE (hard delete por enquanto)
  // ──────────────────────────────────────────────────────────

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);

    const { error } = await this.supabase.adminClient
      .from('contacts')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }

  // ──────────────────────────────────────────────────────────
  // SEARCH (full-text via RPC)
  // ──────────────────────────────────────────────────────────

  /**
   * Full-text search em name/phone/email via RPC `active.search_contacts`
   * (definida em supabase/migrations/002_contacts_search_rpc.sql). Usa o
   * índice GIN idx_contacts_search e ordena por `ts_rank`.
   */
  async search(orgId: string, query: string, limit = 20): Promise<Contact[]> {
    const { data, error } = await this.supabase.adminClient.rpc('search_contacts', {
      p_org_id: orgId,
      p_query: query,
      p_limit: limit,
    });

    if (error) {
      this.logger.error(`search failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as Contact[];
  }

  // ──────────────────────────────────────────────────────────
  // GET /contacts/:id/timeline — eventos do contato
  // ──────────────────────────────────────────────────────────

  /**
   * Linha do tempo do contato (active.contact_timeline). Append-only, ordenada
   * DESC por created_at. Eventos chegam aqui via triggers SQL (deal_won,
   * stage_changed, etc.) e via inserts manuais (note_added pelo agente).
   */
  async getTimeline(
    orgId: string,
    contactId: string,
    limit = 100,
  ): Promise<
    Array<{
      id: string;
      event_type: ContactTimelineEventType;
      title: string | null;
      description: string | null;
      metadata: Json;
      created_by: string | null;
      created_at: string;
    }>
  > {
    await this.findById(orgId, contactId);

    const { data, error } = await this.supabase.adminClient
      .from('contact_timeline')
      .select('id, event_type, title, description, metadata, created_by, created_at')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      this.logger.error(`getTimeline failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return (data ?? []) as Array<{
      id: string;
      event_type: ContactTimelineEventType;
      title: string | null;
      description: string | null;
      metadata: Json;
      created_by: string | null;
      created_at: string;
    }>;
  }

  // ──────────────────────────────────────────────────────────
  // GET /contacts/:id/deals — deals vinculados ao contato
  // ──────────────────────────────────────────────────────────

  /**
   * Deals do contato (ativos e fechados) com nome do stage. Ordenados por
   * `updated_at` DESC. Usado no Contact Detail Sheet → Aba "Negócios".
   */
  async getDeals(
    orgId: string,
    contactId: string,
  ): Promise<
    Array<
      Pick<
        Deal,
        | 'id'
        | 'title'
        | 'value'
        | 'currency'
        | 'stage_id'
        | 'pipeline_id'
        | 'ai_score'
        | 'ai_risk'
        | 'won_at'
        | 'lost_at'
        | 'updated_at'
        | 'created_at'
      > & {
        stage_name: string | null;
        stage_color: string | null;
      }
    >
  > {
    await this.findById(orgId, contactId);

    const { data, error } = await this.supabase.adminClient
      .from('deals')
      .select(
        `id, title, value, currency, stage_id, pipeline_id, ai_score, ai_risk,
         won_at, lost_at, updated_at, created_at,
         stage:pipeline_stages(name, color)`,
      )
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .order('updated_at', { ascending: false });

    if (error) {
      this.logger.error(`getDeals failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return ((data ?? []) as Array<{
      id: string;
      title: string;
      value: number;
      currency: string;
      stage_id: string;
      pipeline_id: string;
      ai_score: number;
      ai_risk: 'low' | 'medium' | 'high' | 'critical' | null;
      won_at: string | null;
      lost_at: string | null;
      updated_at: string;
      created_at: string;
      stage: { name: string; color: string } | Array<{ name: string; color: string }> | null;
    }>).map((d) => {
      const stage = Array.isArray(d.stage) ? d.stage[0] ?? null : d.stage;
      return {
        id: d.id,
        title: d.title,
        value: d.value,
        currency: d.currency,
        stage_id: d.stage_id,
        pipeline_id: d.pipeline_id,
        ai_score: d.ai_score,
        ai_risk: d.ai_risk,
        won_at: d.won_at,
        lost_at: d.lost_at,
        updated_at: d.updated_at,
        created_at: d.created_at,
        stage_name: stage?.name ?? null,
        stage_color: stage?.color ?? null,
      };
    });
  }

  // ──────────────────────────────────────────────────────────
  // helpers
  // ──────────────────────────────────────────────────────────

  /**
   * O parser de filtros do PostgREST trata `,()` como separadores. Removemos
   * esses chars + percent e backslash (que são wildcards/escapes do `like`)
   * pra evitar query malformada e injeção via padrão.
   */
  private escapeIlike(input: string): string {
    return input.replace(/[%_,()\\]/g, '');
  }
}
