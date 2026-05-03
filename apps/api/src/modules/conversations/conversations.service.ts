import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Conversation,
  ConversationDetail,
  InboxItem,
  ChannelType,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import type { PaginatedResult } from '../contacts/contacts.service';

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // CREATE
  // ──────────────────────────────────────────────────────────

  async create(orgId: string, dto: CreateConversationDto): Promise<Conversation> {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .insert({
        org_id: orgId,
        contact_id: dto.contact_id,
        channel_id: dto.channel_id ?? null,
        channel_type: dto.channel_type,
        priority: dto.priority ?? 'normal',
        assigned_to: dto.assigned_to ?? null,
        tags: dto.tags ?? [],
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create conversation',
      );
    }
    return data as Conversation;
  }

  // ──────────────────────────────────────────────────────────
  // FIND ALL (raw conversations table — uso interno)
  // ──────────────────────────────────────────────────────────

  async findAll(
    orgId: string,
    filters: ListConversationsQueryDto,
    currentUserId?: string,
  ): Promise<PaginatedResult<Conversation>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('conversations')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (filters.status) {
      q = q.eq('status', filters.status);
    } else {
      // Sem filtro explícito: oculta archived (soft-deleted).
      // Pra ver arquivadas, passar status=archived.
      q = q.neq('status', 'archived');
    }
    if (filters.priority) q = q.eq('priority', filters.priority);
    if (filters.channel_type) q = q.eq('channel_type', filters.channel_type);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);

    if (filters.mine === 'true' && currentUserId) {
      q = q.eq('assigned_to', currentUserId);
    } else if (filters.assigned_to) {
      q = q.eq('assigned_to', filters.assigned_to);
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as Conversation[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────
  // INBOX (view denormalizada)
  // ──────────────────────────────────────────────────────────

  /**
   * Lista do inbox usando a view `active.v_inbox`. Aplica os mesmos filtros do
   * findAll mas retorna campos do contato/canal/agente já joinados.
   */
  async getInbox(
    orgId: string,
    filters: ListConversationsQueryDto,
    currentUserId?: string,
  ): Promise<PaginatedResult<InboxItem>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('v_inbox')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .range(from, to);

    if (filters.status) {
      q = q.eq('status', filters.status);
    } else {
      // Sem filtro explícito: oculta archived (soft-deleted).
      // Pra ver arquivadas, passar status=archived.
      q = q.neq('status', 'archived');
    }
    if (filters.priority) q = q.eq('priority', filters.priority);
    if (filters.channel_type) q = q.eq('channel_type', filters.channel_type);
    if (filters.contact_id) q = q.eq('contact_id', filters.contact_id);

    if (filters.mine === 'true' && currentUserId) {
      q = q.eq('assigned_to', currentUserId);
    } else if (filters.assigned_to) {
      q = q.eq('assigned_to', filters.assigned_to);
    }

    if (filters.starred === 'true') {
      q = q.eq('is_starred', true);
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`getInbox failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as InboxItem[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  // ──────────────────────────────────────────────────────────
  // toggleStar (Melhoria 9) — alterna is_starred
  // ──────────────────────────────────────────────────────────

  async toggleStar(orgId: string, id: string): Promise<Conversation> {
    const { data: current, error: fetchErr } = await this.supabase.adminClient
      .from('conversations')
      .select('is_starred')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new InternalServerErrorException(fetchErr.message);
    if (!current) throw new NotFoundException(`Conversation ${id} not found`);

    const next = !(current as { is_starred: boolean }).is_starred;
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .update({ is_starred: next })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(`toggleStar failed: ${error?.message}`);
      throw new InternalServerErrorException(error?.message ?? 'Failed to toggle star');
    }
    return data as Conversation;
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY ID (com join no contato)
  // ──────────────────────────────────────────────────────────

  async findById(orgId: string, id: string): Promise<ConversationDetail> {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .select(
        `
        *,
        contact:contacts (
          id, name, phone, email, avatar_url, temperature, score, tags
        )
      `,
      )
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      this.logger.error(`findById failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return data as ConversationDetail;
  }

  /** Versão "raw" sem join — usada internamente quando só precisamos da row. */
  async findByIdRaw(orgId: string, id: string): Promise<Conversation> {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }
    if (!data) {
      throw new NotFoundException(`Conversation ${id} not found`);
    }
    return data as Conversation;
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY CONTACT + CHANNEL (helper de webhooks)
  // ──────────────────────────────────────────────────────────

  /**
   * Busca a conversa "ativa" (status open/pending) do contato neste canal.
   * Retorna a mais recente por last_message_at, ou null se não houver.
   */
  async findByContactAndChannel(
    orgId: string,
    contactId: string,
    channelId: string,
  ): Promise<Conversation | null> {
    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .select('*')
      .eq('org_id', orgId)
      .eq('contact_id', contactId)
      .eq('channel_id', channelId)
      .in('status', ['open', 'pending'])
      .order('last_message_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      this.logger.error(`findByContactAndChannel failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
    return (data as Conversation | null) ?? null;
  }

  async findOrCreate(
    orgId: string,
    contactId: string,
    channelId: string,
    channelType: ChannelType,
  ): Promise<Conversation> {
    const existing = await this.findByContactAndChannel(orgId, contactId, channelId);
    if (existing) return existing;

    return this.create(orgId, {
      contact_id: contactId,
      channel_id: channelId,
      channel_type: channelType,
    });
  }

  // ──────────────────────────────────────────────────────────
  // UPDATE
  // ──────────────────────────────────────────────────────────

  async update(
    orgId: string,
    id: string,
    dto: UpdateConversationDto,
  ): Promise<Conversation> {
    await this.findByIdRaw(orgId, id);

    // Quando muda pra 'resolved', timestampa resolved_at automaticamente.
    const patch: Record<string, unknown> = { ...dto };
    if (dto.status === 'resolved') {
      patch.resolved_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .update(patch)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update conversation',
      );
    }
    return data as Conversation;
  }

  // ──────────────────────────────────────────────────────────
  // MARK AS READ
  // ──────────────────────────────────────────────────────────

  async markAsRead(orgId: string, id: string): Promise<Conversation> {
    await this.findByIdRaw(orgId, id);

    const { data, error } = await this.supabase.adminClient
      .from('conversations')
      .update({ unread_count: 0 })
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`markAsRead failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to mark as read',
      );
    }
    return data as Conversation;
  }
}
