import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type { Message } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
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
  ) {}

  // ──────────────────────────────────────────────────────────
  // CREATE (outbound, agente → contato)
  // ──────────────────────────────────────────────────────────

  /**
   * Persiste uma mensagem outbound na tabela particionada.
   *
   * **Importante**: o trigger `trg_message_insert` (definido em 001) já
   * incrementa `conversations.message_count`, atualiza `last_message_at`
   * e seta `first_response_at` quando aplicável. Não fazemos isso aqui.
   *
   * Status fica como `'pending'` por enquanto. O dispatch via ChannelProvider
   * (WhatsApp Cloud API, etc.) será implementado na Tarefa 3 — quando rodar,
   * deve pegar mensagens com status='pending' e atualizar pra sent/failed.
   */
  async create(
    orgId: string,
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ): Promise<Message> {
    // Garante que a conversa existe e pertence à org (RLS seria redundante
    // já que usamos service-role; verificação manual é a defesa).
    await this.conversations.findByIdRaw(orgId, conversationId);

    const plainText = this.extractPlainText(dto);
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

    const { data, error } = await this.supabase.adminClient
      .from('messages')
      .insert({
        org_id: orgId,
        conversation_id: conversationId,
        direction: 'outbound',
        sender_type: dto.sender_type ?? 'agent',
        sender_id: senderId,
        content_type: dto.content_type,
        content: dto.content,
        plain_text: plainText,
        status: 'pending',
        is_internal_note: dto.is_internal_note ?? false,
        metadata,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create message',
      );
    }
    return data as Message;
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
      .limit(limit + 1); // +1 pra detectar se há mais páginas

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
  // helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Extrai texto pesquisável de `content`. Hoje só cobre `text`, captions e
   * filename de document. Estender conforme necessário.
   */
  private extractPlainText(dto: SendMessageDto): string | null {
    const c = dto.content;
    if (typeof c !== 'object' || c === null || Array.isArray(c)) {
      return null;
    }
    // c agora é { [key: string]: Json }
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
