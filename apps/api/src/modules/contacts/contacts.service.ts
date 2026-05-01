import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Contact } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
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

  constructor(private readonly supabase: SupabaseService) {}

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
    return data as Contact;
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
  // SEARCH
  // ──────────────────────────────────────────────────────────

  /**
   * Busca por substring em name/phone/email.
   *
   * **Nota**: o índice GIN com `to_tsvector('portuguese', ...)` na migration
   * só é aproveitado por queries com a expressão tsvector exata. Como o
   * supabase-js não expressa isso, esta implementação usa `ilike` (sem o
   * índice). Pra usar o índice de fato, criar uma RPC PL/pgSQL e chamar
   * via `.rpc('search_contacts', { p_org_id, p_query, p_limit })`.
   */
  async search(orgId: string, query: string, limit = 20): Promise<Contact[]> {
    const escaped = this.escapeIlike(query);

    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .select('*')
      .eq('org_id', orgId)
      .or(
        `name.ilike.%${escaped}%,phone.ilike.%${escaped}%,email.ilike.%${escaped}%`,
      )
      .limit(limit);

    if (error) {
      this.logger.error(`search failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data ?? []) as Contact[];
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
