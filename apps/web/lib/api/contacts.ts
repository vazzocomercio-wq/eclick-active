import type {
  Contact,
  ContactSource,
  ContactTemperature,
  ContactTimelineEventType,
  CreateContactDto,
  DealRisk,
  Json,
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

  /** GET /contacts/:id/timeline — eventos da timeline do contato */
  getTimeline(id: string, signal?: AbortSignal) {
    return api.get<ContactTimelineItem[]>(`/contacts/${id}/timeline`, { signal });
  },

  /** GET /contacts/:id/deals — deals vinculados ao contato */
  getDeals(id: string, signal?: AbortSignal) {
    return api.get<ContactDealItem[]>(`/contacts/${id}/deals`, { signal });
  },

  /**
   * POST /contacts/:id/verify-whatsapp — força validação síncrona do
   * número (usado quando user clica no badge "?" pra verificar agora).
   */
  verifyWhatsapp(id: string) {
    return api.post<{
      ok: boolean;
      result: {
        exists: boolean;
        jid?: string;
        profile_name?: string;
        profile_pic_url?: string;
        provider: 'baileys' | 'zapi';
      } | null;
    }>(`/contacts/${id}/verify-whatsapp`);
  },

  /**
   * POST /contacts/verify-whatsapp-by-phone — preview da validação
   * checando phone solto, sem persistir. Usado no form de cadastro.
   */
  verifyWhatsappByPhone(phone: string) {
    return api.post<{
      ok: boolean;
      result: {
        exists: boolean;
        jid?: string;
        profile_name?: string;
        profile_pic_url?: string;
        provider: 'baileys' | 'zapi';
      } | null;
    }>('/contacts/verify-whatsapp-by-phone', { phone });
  },

  /** GET /contacts/whatsapp-stats — métricas de validação */
  whatsappStats(signal?: AbortSignal) {
    return api.get<{
      total: number;
      verified_valid: number;
      verified_invalid: number;
      not_verified: number;
      pending: number;
    }>('/contacts/whatsapp-stats', { signal });
  },

  /**
   * POST /contacts/verify-whatsapp/batch — enfileira N contatos pra validação
   * em background. Worker processa respeitando rate limit do provider.
   */
  verifyWhatsappBatch(contactIds: string[]) {
    return api.post<{ enqueued: number }>('/contacts/verify-whatsapp/batch', {
      contact_ids: contactIds,
    });
  },
};

// ──────────────────────────────────────────────────────────
// Tipos retornados pelos endpoints novos
// ──────────────────────────────────────────────────────────

export interface ContactTimelineItem {
  id: string;
  event_type: ContactTimelineEventType;
  title: string | null;
  description: string | null;
  metadata: Json;
  created_by: string | null;
  created_at: string;
}

export interface ContactDealItem {
  id: string;
  title: string;
  value: number;
  currency: string;
  stage_id: string;
  pipeline_id: string;
  ai_score: number;
  ai_risk: DealRisk | null;
  won_at: string | null;
  lost_at: string | null;
  updated_at: string;
  created_at: string;
  stage_name: string | null;
  stage_color: string | null;
}

// Re-export tipo para conveniência (consumers da página não precisam importar do shared)
export type { Contact, ContactTemperature, ContactSource, CreateContactDto, UpdateContactDto };
