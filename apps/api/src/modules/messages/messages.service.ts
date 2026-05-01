import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Message, MessageDeliveryStatus } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { ChannelDispatcherService } from '../../common/channels/channel-dispatcher.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { ConversationsService } from '../conversations/conversations.service';
import { SendMessageDto } from './dto/send-message.dto';

export interface CursorPaginatedResult<T> {
  data: T[];
  /** ISO 8601 — passe no próximo request como `?cursor=...`. null = fim. */
  nextCursor: string | null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly conversations: ConversationsService,
    private readonly dispatcher: ChannelDispatcherService,
    private readonly events: EventsGateway,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CREATE (outbound, agente → contato)
  // ──────────────────────────────────────────────────────────

  /**
   * Persiste mensagem outbound e despacha via ChannelProvider.
   *
   * Fluxo:
   *   1. Persiste com status='pending' (ou 'sent' se for nota interna)
   *   2. Se nota interna → retorna (não dispara provider)
   *   3. Chama `dispatcher.send()` — resolve channel + recipient + provider
   *   4. Atualiza status pra 'sent' (com channel_message_id) ou 'failed'
   *      (com error_code/error_message)
   *
   * **Trigger SQL** `trg_message_insert` cuida de message_count,
   * last_message_at e first_response_at — não duplico aqui.
   */
  async create(
    orgId: string,
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    const conv = await this.conversations.findByIdRaw(orgId, conversationId);

    const isInternalNote = dto.is_internal_note ?? false;
    const initialStatus: MessageDeliveryStatus = isInternalNote ? 'sent' : 'pending';

    let persisted = await this.persist({
      org_id: orgId,
      conversation_id: conversationId,
      direction: 'outbound',
      sender_type: dto.sender_type ?? 'agent',
      sender_id: senderId,
      content_type: dto.content_type,
      content: dto.content,
      plain_text: this.extractPlainText(dto),
      status: initialStatus,
      is_internal_note: isInternalNote,
      metadata: this.buildMetadata(dto),
    });

    // Notas internas não vão pro provider — pulam direto pro emit.
    if (!isInternalNote) {
      if (!conv.channel_id) {
        // Conversa sem channel_id é inválida pra outbound (rota interna
        // não-canal ainda não existe).
        persisted = await this.markFailed(
          persisted,
          'no_channel',
          'Conversa não tem channel_id atribuído',
        );
      } else {
        try {
          const result = await this.dispatcher.send({
            org_id: orgId,
            channel_id: conv.channel_id,
            contact_id: conv.contact_id,
            content_type: dto.content_type,
            content: dto.content,
            reply_to_channel_message_id: dto.reply_to_channel_message_id,
          });
          persisted = await this.markSent(persisted, result.channel_message_id);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.error(`dispatch failed: ${message}`);
          persisted = await this.markFailed(persisted, 'dispatch_error', message);
        }
      }
    }

    // Emit pra outros agentes vendo a mesma conversa em tempo real.
    // Cobre todos os finais de fluxo: nota interna ('sent'), no-channel
    // ('failed'), dispatch ok ('sent') ou dispatch erro ('failed').
    await this.emitMessageEvents(orgId, conversationId, persisted);

    return persisted;
  }

  private async emitMessageEvents(
    orgId: string,
    conversationId: string,
    message: Message,
  ): Promise<void> {
    try {
      this.events.emitToOrg(orgId, 'message:new', {
        conversation_id: conversationId,
        message,
      });
      // Re-fetch pra capturar counters atualizados pelo trg_message_insert
      const conversation = await this.conversations.findByIdRaw(orgId, conversationId);
      this.events.emitToOrg(orgId, 'conversation:updated', { conversation });
    } catch (err) {
      this.logger.warn(
        `Event emit failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // ──────────────────────────────────────────────────────────
  // FIND BY CONVERSATION (cursor pagination)
  // ──────────────────────────────────────────────────────────

  /**
   * Lista mensagens da conversa com cursor pagination.
   *
   * Sem cursor: retorna as `limit` mais recentes (DESC).
   * Com cursor: retorna mensagens com `created_at < cursor` (mais antigas).
   *
   * Por que cursor e não OFFSET? `active.messages` é particionada por mês —
   * `OFFSET N` força o planner a buscar e descartar N rows em todas as
   * partições, custo proporcional a OFFSET. Cursor usa o índice composto
   * `idx_messages_conversation (conversation_id, created_at DESC)` direto.
   */
  async findByConversation(
    orgId: string,
    conversationId: string,
    cursor?: string,
    limit = 50,
  ): Promise<CursorPaginatedResult<Message>> {
    await this.conversations.findByIdRaw(orgId, conversationId);

    let q = this.supabase.adminClient
      .from('messages')
      .select('*')
      .eq('org_id', orgId)
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      q = q.lt('created_at', cursor);
    }

    const { data, error } = await q;
    if (error) {
      this.logger.error(`findByConversation failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (data ?? []) as Message[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor =
      hasMore && items.length > 0 ? items[items.length - 1]!.created_at : null;

    return { data: items, nextCursor };
  }

  // ──────────────────────────────────────────────────────────
  // helpers internos (persist + status updates)
  // ──────────────────────────────────────────────────────────

  private async persist(payload: Record<string, unknown>): Promise<Message> {
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .insert(payload)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`persist failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create message',
      );
    }
    return data as Message;
  }

  private async markSent(
    persisted: Message,
    channelMessageId: string,
  ): Promise<Message> {
    return this.updateStatus(persisted, {
      status: 'sent',
      channel_message_id: channelMessageId,
      error_code: null,
      error_message: null,
    });
  }

  private async markFailed(
    persisted: Message,
    errorCode: string,
    errorMessage: string,
  ): Promise<Message> {
    return this.updateStatus(persisted, {
      status: 'failed',
      error_code: errorCode,
      error_message: errorMessage,
    });
  }

  private async updateStatus(
    persisted: Message,
    patch: Record<string, unknown>,
  ): Promise<Message> {
    // `messages` é particionada por created_at — incluir created_at no WHERE
    // ajuda o planner a fazer partition pruning direto pra partição certa.
    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .update(patch)
      .eq('org_id', persisted.org_id)
      .eq('id', persisted.id)
      .eq('created_at', persisted.created_at)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`updateStatus failed: ${error?.message}`);
      // Não derruba o request — devolve o `persisted` com o patch aplicado em memória
      // Cliente pode re-fetch pra ver estado real.
      return { ...persisted, ...patch } as Message;
    }
    return data as Message;
  }

  private buildMetadata(dto: SendMessageDto): Record<string, unknown> {
    const metadata: Record<string, unknown> = {};
    if (dto.reply_to_channel_message_id) {
      metadata.quoted_channel_message_id = dto.reply_to_channel_message_id;
    }
    if (dto.template_id) {
      metadata.template_id = dto.template_id;
      if (dto.template_variables) {
        metadata.template_variables = dto.template_variables;
      }
    }
    return metadata;
  }

  private extractPlainText(dto: SendMessageDto): string | null {
    const c = dto.content;
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return null;
    }
    if (dto.content_type === 'text' && typeof c.body === 'string') {
      return c.body;
    }
    if (
      (dto.content_type === 'image' || dto.content_type === 'video') &&
      typeof c.caption === 'string'
    ) {
      return c.caption;
    }
    if (dto.content_type === 'document' && typeof c.filename === 'string') {
      return c.filename;
    }
    return null;
  }
}
