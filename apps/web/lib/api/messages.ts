import type {
  Json,
  Message,
  MessageContentType,
  SendMessageDto,
} from '@eclick-active/shared';
import { api } from './client';

export interface CursorPaginatedResult<T> {
  data: T[];
  /** ISO 8601 — passe no próximo request como `?cursor=...`. null = fim. */
  nextCursor: string | null;
}

export const messagesApi = {
  getByConversation(
    conversationId: string,
    cursor?: string,
    limit = 50,
    signal?: AbortSignal,
  ) {
    return api.get<CursorPaginatedResult<Message>>(
      `/conversations/${conversationId}/messages`,
      {
        query: { cursor, limit },
        signal,
      },
    );
  },

  send(conversationId: string, dto: SendMessageDto) {
    return api.post<Message>(`/conversations/${conversationId}/messages`, dto);
  },

  /** Atalho conveniente pra enviar texto. */
  sendText(conversationId: string, body: string, isInternalNote = false) {
    const dto: SendMessageDto = {
      content_type: 'text',
      content: { body } as unknown as Json,
      is_internal_note: isInternalNote,
    };
    return this.send(conversationId, dto);
  },
};

export type { Message, MessageContentType, SendMessageDto };
