import type {
  CreateTagDefinitionDto,
  TagDefinition,
  TagEntityType,
  UpdateTagDefinitionDto,
  UpsertTagDefinitionsDto,
} from '@eclick-active/shared';
import { api } from './client';

export interface ListTagsParams {
  entity_type?: TagEntityType;
  search?: string;
  category?: string;
}

export const tagsApi = {
  list(params: ListTagsParams = {}, signal?: AbortSignal) {
    return api.get<TagDefinition[]>('/tags', {
      query: {
        entity_type: params.entity_type,
        search: params.search,
        category: params.category,
      },
      signal,
    });
  },

  get(id: string, signal?: AbortSignal) {
    return api.get<TagDefinition>(`/tags/${id}`, { signal });
  },

  create(dto: CreateTagDefinitionDto) {
    return api.post<TagDefinition>('/tags', dto);
  },

  update(id: string, dto: UpdateTagDefinitionDto) {
    return api.patch<TagDefinition>(`/tags/${id}`, dto);
  },

  remove(id: string) {
    return api.delete<void>(`/tags/${id}`);
  },

  /**
   * Upsert em batch — usado pelo Concierge IA pra criar tags inéditas
   * geradas pela IA + incrementar usage_count nas existentes.
   */
  upsertMany(dto: UpsertTagDefinitionsDto) {
    return api.post<TagDefinition[]>('/tags/upsert-many', dto);
  },
};

export type { TagDefinition, TagEntityType, CreateTagDefinitionDto, UpdateTagDefinitionDto };
