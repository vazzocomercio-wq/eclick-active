import type {
  ChannelType,
  Conversation,
  ConversationDetail,
  ConversationPriority,
  ConversationStatus,
  CreateConversationDto,
  InboxItem,
  Message,
  UpdateConversationDto,
} from '@eclick-active/shared';
import { api } from './client';
import type { PaginatedResult } from './contacts';

export interface StartConversationInput {
  contact_id: string;
  channel_id: string;
  message: string;
  message_type?: 'text';
  is_internal_note?: boolean;
}

export interface StartConversationResponse {
  conversation: Conversation;
  message: Message;
  /** True se a conversa já existia e foi reaproveitada. */
  reused: boolean;
}

export interface InboxParams {
  page?: number;
  limit?: number;
  status?: ConversationStatus;
  channel_type?: ChannelType;
  assigned_to?: string;
  /** "true" pra filtrar somente conversas atribuídas ao usuário atual */
  mine?: boolean;
  /** Filtra conversas de um contato específico (drawer do deal/contato). */
  contact_id?: string;
  /** Filtra somente conversas favoritas (is_starred=true). */
  starred?: boolean;
}

export interface CreateConversationInput {
  contact_id: string;
  channel_type: ChannelType;
  channel_id?: string;
  priority?: ConversationPriority;
  assigned_to?: string;
  tags?: string[];
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
        contact_id: params.contact_id,
        mine: params.mine ? 'true' : undefined,
        starred: params.starred ? 'true' : undefined,
      },
      signal,
    });
  },

  /** Conversas de um contato (recentes primeiro). */
  getByContactId(contactId: string, signal?: AbortSignal) {
    return api.get<PaginatedResult<InboxItem>>('/conversations', {
      query: { contact_id: contactId, limit: 25 },
      signal,
    });
  },

  getById(id: string, signal?: AbortSignal) {
    return api.get<ConversationDetail>(`/conversations/${id}`, { signal });
  },

  create(input: CreateConversationInput) {
    return api.post<Conversation>('/conversations', input);
  },

  /**
   * POST /conversations/start — vendedor inicia conversa outbound.
   * Reaproveita conversa existente se já houver pra (contato, canal).
   */
  start(input: StartConversationInput) {
    return api.post<StartConversationResponse>('/conversations/start', input);
  },

  update(id: string, dto: UpdateConversationDto) {
    return api.patch<Conversation>(`/conversations/${id}`, dto);
  },

  markAsRead(id: string) {
    return api.post<Conversation>(`/conversations/${id}/read`);
  },

  /** POST /conversations/:id/star — toggle favorito (Melhoria 9) */
  toggleStar(id: string) {
    return api.post<Conversation>(`/conversations/${id}/star`);
  },
};

export type {
  Conversation,
  ConversationDetail,
  CreateConversationDto,
  InboxItem,
  UpdateConversationDto,
};
