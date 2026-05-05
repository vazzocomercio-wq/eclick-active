import type { OrgMemberRole } from '@eclick-active/shared';
import { api } from './client';

export interface MemberView {
  id: string;
  user_id: string;
  org_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: OrgMemberRole;
  status: 'active' | 'invited' | 'suspended';
  workspace_ids: string[];
  last_seen_at: string | null;
  /** Especialidades/serviços que atende. Genérico por nicho. */
  specialties: string[];
  /** Duração padrão por atendimento (minutos). NULL = usa appointment_type. */
  default_duration_minutes: number | null;
  /** Buffer entre atendimentos (minutos). Default 0. */
  default_buffer_minutes: number;
  created_at: string;
  updated_at: string;
}

export interface MemberStats {
  active_conversations: number;
  open_deals: number;
  pending_tasks: number;
  last_seen_at: string | null;
}

export interface InviteMemberInput {
  email: string;
  role: 'admin' | 'manager' | 'agent' | 'viewer';
  display_name?: string;
}

export interface UpdateMemberInput {
  role?: OrgMemberRole;
  workspace_ids?: string[];
  display_name?: string;
  specialties?: string[];
  default_duration_minutes?: number | null;
  default_buffer_minutes?: number;
}

export const teamApi = {
  list(signal?: AbortSignal): Promise<MemberView[]> {
    return api.get<MemberView[]>('/team', { signal });
  },
  invite(input: InviteMemberInput): Promise<MemberView> {
    return api.post<MemberView>('/team/invite', input);
  },
  update(id: string, input: UpdateMemberInput): Promise<MemberView> {
    return api.patch<MemberView>(`/team/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/team/${id}`);
  },
  stats(id: string, signal?: AbortSignal): Promise<MemberStats> {
    return api.get<MemberStats>(`/team/${id}/stats`, { signal });
  },
};
