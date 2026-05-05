import type { AiAgentPersona, PersonaTemplate } from '@eclick-active/shared';
import { api } from './client';

export interface ApplyTemplateInput {
  template_id: string;
  create_appointment_types?: boolean;
}

export interface ApplyTemplateResponse {
  persona: AiAgentPersona;
  applied: {
    template_id: string;
    business_context_set: boolean;
    appointment_types_created: number;
  };
}

export interface CreatePersonaInput {
  name: string;
  avatar_url?: string;
  role?: AiAgentPersona['role'];
  personality?: string;
  tone?: AiAgentPersona['tone'];
  response_length?: AiAgentPersona['response_length'];
  language?: string;
  response_delay_seconds?: number;
  guidelines?: string[];
  forbidden_topics?: string[];
  greeting_message?: string;
  fallback_message?: string;
  is_default?: boolean;
  is_active?: boolean;
  settings?: Record<string, unknown>;
}

export type UpdatePersonaInput = Partial<CreatePersonaInput>;

export const aiPersonaApi = {
  list(signal?: AbortSignal): Promise<AiAgentPersona[]> {
    return api.get<AiAgentPersona[]>('/ai/personas', { signal });
  },
  getDefault(signal?: AbortSignal): Promise<AiAgentPersona | null> {
    return api.get<AiAgentPersona | null>('/ai/personas/default', { signal });
  },
  getById(id: string, signal?: AbortSignal): Promise<AiAgentPersona> {
    return api.get<AiAgentPersona>(`/ai/personas/${id}`, { signal });
  },
  create(input: CreatePersonaInput): Promise<AiAgentPersona> {
    return api.post<AiAgentPersona>('/ai/personas', input);
  },
  update(id: string, input: UpdatePersonaInput): Promise<AiAgentPersona> {
    return api.patch<AiAgentPersona>(`/ai/personas/${id}`, input);
  },
  setDefault(id: string): Promise<AiAgentPersona> {
    return api.post<AiAgentPersona>(`/ai/personas/${id}/set-default`);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/ai/personas/${id}`);
  },
  listTemplates(signal?: AbortSignal): Promise<PersonaTemplate[]> {
    return api.get<PersonaTemplate[]>('/ai/personas/templates', { signal });
  },
  applyTemplate(input: ApplyTemplateInput): Promise<ApplyTemplateResponse> {
    return api.post<ApplyTemplateResponse>('/ai/personas/apply-template', input);
  },
};
