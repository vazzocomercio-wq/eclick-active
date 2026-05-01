import type {
  Conversation,
  ConversationDetail,
  ConversationStatus,
  InboxItem,
  UpdateConversationDto,
} from '@eclick-active/shared';
import { api } from './client';
import type { PaginatedResult } from './contacts';

export interface InboxParams {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
  channel_type?: string;
  assigned_to?: string;
  /** "true" pra filtrar somente conversas atribuídas ao usuário atual */
  mine?: boolean;
}

export const conversationsApi = {
  getInbox(params: InboxParams = {}, signal?: AbortSignal) {
    return api.get<PaginatedResult<InboxItem>>('/conversations', {
      query: {
        page: params.page,
        limit: params.limit,
        status: params.status,
        channel_type: params.channel_type,
        assigned_to: params.assigned_to,
        mine: params.mine ? 'true' : undefined,
      },
      signal,
    });
  },

  getById(id: string, signal?: AbortSignal) {
    return api.get<ConversationDetail>(`/conversations/${id}`, { signal });
  },

  update(id: string, dto: UpdateConversationDto) {
    return api.patch<Conversation>(`/conversations/${id}`, dto);
  },

  markAsRead(id: string) {
    return api.post<Conversation>(`/conversations/${id}/read`);
  },
};

export type { Conversation, ConversationDetail, InboxItem, UpdateConversationDto };
