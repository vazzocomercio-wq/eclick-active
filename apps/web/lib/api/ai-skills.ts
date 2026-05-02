import type { AiAgentSkill, AiSkill, AiSkillAction } from '@eclick-active/shared';
import { api } from './client';

export interface CreateSkillInput {
  name: string;
  description: string;
  system_prompt: string;
  knowledge_source_ids?: string[];
  knowledge_categories?: string[];
  allowed_actions?: AiSkillAction[];
  trigger_conditions?: Record<string, unknown>;
  priority?: number;
  is_active?: boolean;
}

export type UpdateSkillInput = Partial<CreateSkillInput>;

export interface AttachSkillInput {
  skill_id: string;
  priority?: number;
}

export const aiSkillsApi = {
  list(signal?: AbortSignal): Promise<AiSkill[]> {
    return api.get<AiSkill[]>('/ai/skills', { signal });
  },
  getById(id: string, signal?: AbortSignal): Promise<AiSkill> {
    return api.get<AiSkill>(`/ai/skills/${id}`, { signal });
  },
  create(input: CreateSkillInput): Promise<AiSkill> {
    return api.post<AiSkill>('/ai/skills', input);
  },
  update(id: string, input: UpdateSkillInput): Promise<AiSkill> {
    return api.patch<AiSkill>(`/ai/skills/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/ai/skills/${id}`);
  },
  seed(): Promise<{ created: number; skipped: number }> {
    return api.post<{ created: number; skipped: number }>('/ai/skills/seed');
  },

  // Persona ↔ skill
  listForPersona(personaId: string, signal?: AbortSignal): Promise<Array<AiSkill & { agent_priority: number; agent_skill_id: string }>> {
    return api.get(`/ai/personas/${personaId}/skills`, { signal });
  },
  attachToPersona(personaId: string, input: AttachSkillInput): Promise<AiAgentSkill> {
    return api.post<AiAgentSkill>(`/ai/personas/${personaId}/skills`, input);
  },
  detachFromPersona(personaId: string, skillId: string): Promise<void> {
    return api.delete<void>(`/ai/personas/${personaId}/skills/${skillId}`);
  },
  reorderPersonaSkills(personaId: string, skillIds: string[]): Promise<void> {
    return api.put<void>(`/ai/personas/${personaId}/skills/reorder`, { skill_ids: skillIds });
  },
};
