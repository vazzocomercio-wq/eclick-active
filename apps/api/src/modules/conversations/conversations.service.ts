import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  Channel,
  Contact,
  Conversation,
  ConversationDetail,
  InboxItem,
  ChannelType,
  Message,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { ListConversationsQueryDto } from './dto/list-conversations.query.dto';
import type { PaginatedResult } from '../contacts/contacts.service';

export interface StartConversationResult {
  conversation: Conversation;
  message: Message;
  /** True se a conversa já existia e foi reaproveitada em vez de criar nova. */
  reused: boolean;
}

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly events: EventsGateway,
  ) {}

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
    const created = data as Conversation;
    // Emit pra inbox de todos os agentes da org atualizar em tempo real
    this.events.emitToOrg(orgId, 'conversation:updated', { conversation: created });
    return created;
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
    const updated = data as Conversation;
    // Emit pra refletir o toggle em outras sessões/abas abertas
    this.events.emitToOrg(orgId, 'conversation:updated', { conversation: updated });
    return updated;
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
          id, name, phone, email, avatar_url, temperature, score, tags,
          whatsapp_verified, whatsapp_jid, whatsapp_profile_name, whatsapp_profile_pic_url
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
  // START CONVERSATION — vendedor inicia conversa do zero
  // ──────────────────────────────────────────────────────────

  /**
   * Cria conversa outbound + envia primeira mensagem pelo canal escolhido.
   *
   * Regras:
   *  1. Contato existe e tem identificador pro canal (phone pra WhatsApp,
   *     email pra Email, etc — validado pelo dispatcher).
   *  2. Se canal whatsapp_free e contato tem `whatsapp_verified=false`,
   *     bloqueia com 400 "número não é WhatsApp" (avisa o vendedor).
   *     Se whatsapp_verified=null (não validado), permite mas registra
   *     warning — pode falhar no envio.
   *  3. Se já existe conversa ativa pro mesmo (contato, canal), REUTILIZA
   *     em vez de criar nova. Retorna `reused: true` pra UI mostrar toast
   *     "Conversa existente — abrindo".
   *  4. Persiste mensagem outbound (sender_type=agent) e tenta dispatch.
   *     Sucesso → status='sent'. Falha → status='failed' + error_code.
   *  5. Emit Socket.IO: `conversation:created` (se nova) + `message:new`.
   */
  async startConversation(
    orgId: string,
    senderId: string,
    dto: StartConversationDto,
  ): Promise<StartConversationResult> {
    // 1. Carrega contato e canal
    const [contact, channel] = await Promise.all([
      this.fetchContact(orgId, dto.contact_id),
      this.fetchChannel(orgId, dto.channel_id),
    ]);

    if (channel.status !== 'active') {
      throw new BadRequestException(
        `Canal "${channel.name}" não está ativo (status=${channel.status})`,
      );
    }

    // 2. Verifica que contato é alcançável pelo canal
    this.assertReachable(contact, channel);

    // 3. Reaproveita conversa existente se houver
    let conversation = await this.findByContactAndChannel(
      orgId,
      dto.contact_id,
      dto.channel_id,
    );
    const reused = !!conversation;

    if (!conversation) {
      conversation = await this.create(orgId, {
        contact_id: dto.contact_id,
        channel_id: dto.channel_id,
        channel_type: channel.channel_type,
      });
      // Marca como outbound-initiated em metadata pra futuras analytics
      await this.supabase.adminClient
        .from('conversations')
        .update({
          metadata: {
            ...(conversation.metadata ?? {}),
            initiated_by: 'agent',
            initiated_at: new Date().toISOString(),
          },
        })
        .eq('id', conversation.id);
      this.events.emitToOrg(orgId, 'conversation:updated', { conversation });
    }

    // 4. Persiste mensagem outbound
    const isNote = dto.is_internal_note === true;
    const initialStatus = isNote ? 'sent' : 'pending';
    const { data: persisted, error: persistErr } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: orgId,
        conversation_id: conversation.id,
        direction: 'outbound',
        sender_type: 'agent',
        sender_id: senderId,
        content_type: 'text',
        content: { body: dto.message },
        plain_text: dto.message,
        status: initialStatus,
        is_internal_note: isNote,
        metadata: { source: 'start_conversation' },
      })
      .select('*')
      .single();

    if (persistErr || !persisted) {
      this.logger.error(`startConversation persist failed: ${persistErr?.message}`);
      throw new InternalServerErrorException(
        persistErr?.message ?? 'Falha ao persistir mensagem',
      );
    }
    let message = persisted as Message;
    this.logger.log(
      `[startConversation] msg persisted id=${message.id} conv=${conversation.id} channel=${dto.channel_id} isNote=${isNote}`,
    );

    // 5. Dispatch (pula se for nota interna)
    if (!isNote) {
      try {
        this.logger.log(
          `[startConversation] calling dispatcher.send channel=${dto.channel_id} contact=${dto.contact_id}`,
        );
        const result = await this.dispatcher.send({
          org_id: orgId,
          channel_id: dto.channel_id,
          contact_id: dto.contact_id,
          content_type: 'text',
          content: { body: dto.message },
        });
        this.logger.log(
          `[startConversation] dispatcher.send OK channel_message_id=${result.channel_message_id}`,
        );
        message = await this.updateMessageStatus(message, {
          status: 'sent',
          channel_message_id: result.channel_message_id,
          error_code: null,
          error_message: null,
        });
        this.logger.log(`[startConversation] marked as sent`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const stack = err instanceof Error ? err.stack : '';
        this.logger.error(
          `[startConversation] dispatch failed: ${msg}\n${stack}`,
        );
        message = await this.updateMessageStatus(message, {
          status: 'failed',
          error_code: 'start_dispatch_error',
          error_message: msg,
        });
        // NÃO joga exception — devolve a mensagem com status=failed pra UI
        // mostrar erro inline no toast/feedback.
      }
    }

    // 6. Emit pro frontend (todos os agentes da org veem a conversa nova)
    this.events.emitToOrg(orgId, 'message:new', {
      conversation_id: conversation.id,
      message,
    });

    return { conversation, message, reused };
  }

  /**
   * Update de status em active.messages com partition pruning.
   *
   * `messages` é PARTITION BY RANGE (created_at) — o WHERE precisa
   * incluir `created_at` pra o planner achar a partição correta. Sem
   * isso, o `.update().select().single()` do PostgREST retorna null
   * silenciosamente e a mensagem fica pra sempre no status original.
   *
   * Mesmo padrão de MessagesService.updateStatus.
   */
  private async updateMessageStatus(
    persisted: Message,
    patch: Record<string, unknown>,
  ): Promise<Message> {
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .update(patch)
      .eq('org_id', persisted.org_id)
      .eq('id', persisted.id)
      .eq('created_at', persisted.created_at)
      .select('*')
      .single();
    if (error || !data) {
      this.logger.error(
        `startConversation update message status falhou: ${error?.message ?? 'sem dados retornados'}`,
      );
      return persisted;
    }
    return data as Message;
  }

  private async fetchContact(orgId: string, contactId: string): Promise<Contact> {
    const { data, error } = await this.supabase.adminClient
      .from('contacts')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', contactId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Contato não encontrado');
    return data as Contact;
  }

  private async fetchChannel(orgId: string, channelId: string): Promise<Channel> {
    const { data, error } = await this.supabase.adminClient
      .from('channels')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', channelId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException('Canal não encontrado');
    return data as Channel;
  }

  private assertReachable(contact: Contact, channel: Channel): void {
    const t = channel.channel_type;
    if (t === 'whatsapp' || t === 'whatsapp_free') {
      if (!contact.phone) {
        throw new BadRequestException(
          'Contato não tem telefone — adicione antes de enviar WhatsApp',
        );
      }
      if (t === 'whatsapp_free' && contact.whatsapp_verified === false) {
        throw new BadRequestException(
          'Este número não é WhatsApp (verificado). Não é possível enviar.',
        );
      }
      // whatsapp_verified=null (não validado) é permitido — pode falhar no envio
    } else if (t === 'email') {
      if (!contact.email) {
        throw new BadRequestException(
          'Contato não tem e-mail — adicione antes de enviar mensagem por e-mail',
        );
      }
    } else if (t === 'instagram') {
      const profile = (contact.channel_profiles ?? {})['instagram'];
      const igId = (profile as { ig_id?: string } | undefined)?.ig_id;
      if (!igId) {
        throw new BadRequestException(
          'Contato não tem perfil do Instagram vinculado',
        );
      }
    }
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
    const updated = data as Conversation;
    // Emit pra inbox dos agentes atualizar em tempo real (arquivar,
    // resolver, atribuir, mudar prioridade, etc precisam aparecer sem F5).
    this.events.emitToOrg(orgId, 'conversation:updated', { conversation: updated });
    return updated;
  }

  // ──────────────────────────────────────────────────────────
  // MARK AS READ
  // ──────────────────────────────────────────────────────────

  // ──────────────────────────────────────────────────────────
  // DELETE — exclui conversa + mensagens (CASCADE no banco)
  // ──────────────────────────────────────────────────────────

  async delete(orgId: string, id: string): Promise<void> {
    // Confirma que existe e pertence à org antes de deletar
    const before = await this.findByIdRaw(orgId, id);

    // Log defensivo — várias deleções acidentais foram detectadas em prod
    // (msgs ficam órfãs porque CASCADE não funciona em partições). Estes
    // logs ajudam a rastrear quem/quando dispara.
    this.logger.warn(
      `[conversations] DELETE conv=${id} org=${orgId} contact=${before.contact_id} channel=${before.channel_id} status=${before.status} msg_count=${before.message_count}`,
    );

    // Antes de deletar a conversa, apaga manualmente as messages dela.
    // A FK ON DELETE CASCADE definida na tabela parent NÃO cascata para
    // partições — bug conhecido do Postgres com partition+FK. Sem isso
    // as messages ficam órfãs após o delete da conversation.
    const { error: msgErr } = await this.supabase.adminClient
      .from('messages')
      .delete()
      .eq('org_id', orgId)
      .eq('conversation_id', id);
    if (msgErr) {
      this.logger.warn(
        `[conversations] cleanup messages órfãs falhou (não fatal): ${msgErr.message}`,
      );
    }

    const { error } = await this.supabase.adminClient
      .from('conversations')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete failed: ${error.message}`);
      throw new InternalServerErrorException(
        error.message ?? 'Failed to delete conversation',
      );
    }

    // Emit pra inbox remover de todas as sessões abertas
    this.events.emitToOrg(orgId, 'conversation:updated', {
      conversation: { id, status: 'archived', org_id: orgId } as unknown as Conversation,
    });
    // ATENÇÃO: messages FK em conversations tem ON DELETE CASCADE no schema —
    // todas as mensagens da conversa são removidas junto. Idem deals que
    // tinham conversation_id (esse vira null por ON DELETE SET NULL).
  }

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
    const updated = data as Conversation;
    // Emit pra zerar o contador de não lidas em todas as sessões abertas
    this.events.emitToOrg(orgId, 'conversation:updated', { conversation: updated });
    return updated;
  }
}
