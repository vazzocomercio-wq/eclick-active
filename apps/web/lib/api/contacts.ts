import type {
  Contact,
  ContactSource,
  ContactTemperature,
  CreateContactDto,
  UpdateContactDto,
} from '@eclick-active/shared';
import { api } from './client';

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ListContactsParams {
  page?: number;
  limit?: number;
  search?: string;
  temperature?: ContactTemperature;
  tags?: string[];
}

export const contactsApi = {
  list(params: ListContactsParams = {}, signal?: AbortSignal) {
    return api.get<PaginatedResult<Contact>>('/contacts', {
      query: {
        page: params.page,
        limit: params.limit,
        search: params.search,
        temperature: params.temperature,
        tags: params.tags,
      },
      signal,
    });
  },

  get(id: string, signal?: AbortSignal) {
    return api.get<Contact>(`/contacts/${id}`, { signal });
  },

  search(q: string, limit = 20, signal?: AbortSignal) {
    return api.get<Contact[]>('/contacts/search', { query: { q, limit }, signal });
  },

  create(dto: CreateContactDto) {
    return api.post<Contact>('/contacts', dto);
  },

  update(id: string, dto: UpdateContactDto) {
    return api.patch<Contact>(`/contacts/${id}`, dto);
  },

  remove(id: string) {
    return api.delete<void>(`/contacts/${id}`);
  },
};

// Re-export tipo para conveniência (consumers da página não precisam importar do shared)
export type { Contact, ContactTemperature, ContactSource, CreateContactDto, UpdateContactDto };
