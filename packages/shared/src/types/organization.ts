import type { Json, UUID, ISODateString } from './common';
import type { Plan, OrgMemberRole, OrgMemberStatus } from '../enums';

/**
 * Organização cliente do CRM. É a unidade de cobrança e isolamento.
 * Tabela: active.organizations
 */
export interface Organization {
  id: UUID;
  name: string;
  slug: string;
  plan: Plan;
  settings: Json;
  /** Limite de usuários com base no plano (denormalizado pra checagem rápida) */
  max_users: number;
  max_channels: number;
  max_pipelines: number;
  max_automations: number;
  /** Feature flags por plano */
  has_copilot: boolean;
  has_audit: boolean;
  has_erp_integration: boolean;
  /** FK para public.organizations do e-Click SaaS (se instância compartilhada) */
  saas_org_id: UUID | null;
  trial_ends_at: ISODateString | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Vínculo entre um usuário (auth.users) e uma organização.
 * Tabela: active.org_members
 */
export interface OrgMember {
  id: UUID;
  org_id: UUID;
  /** Referência a auth.users.id do Supabase */
  user_id: UUID;
  role: OrgMemberRole;
  workspace_ids: UUID[];
  display_name: string | null;
  avatar_url: string | null;
  status: OrgMemberStatus;
  last_seen_at: ISODateString | null;
  /**
   * Especialidades/serviços que o profissional atende. Texto livre por
   * org pra cobrir qualquer nicho — clínica ('nutricionista'), salão
   * ('corte'), oficina ('motor'), B2B ('vendas'), etc. IA do Concierge
   * usa pra match contra mensagem do cliente ao detectar agendamento.
   */
  specialties: string[];
  /**
   * Duração padrão por atendimento em minutos. Sistema usa pra calcular
   * slots disponíveis automaticamente. NULL = usa duração do
   * appointment_type (modelo legado/avançado).
   */
  default_duration_minutes: number | null;
  /** Buffer entre atendimentos em minutos. Default 0. */
  default_buffer_minutes: number;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Sub-divisão opcional dentro de uma organização (ex: filiais, equipes).
 * Tabela: active.workspaces
 */
export interface Workspace {
  id: UUID;
  org_id: UUID;
  name: string;
  description: string | null;
  settings: Json;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Chave de API para integrações externas. `key_hash` armazenado com bcrypt.
 * Tabela: active.api_keys
 */
export interface ApiKey {
  id: UUID;
  org_id: UUID;
  name: string;
  /** Hash bcrypt da chave — nunca o texto plano */
  key_hash: string;
  /** Primeiros 8 chars pra exibição (ex: "eca_live_") */
  key_prefix: string;
  scopes: string[];
  last_used_at: ISODateString | null;
  expires_at: ISODateString | null;
  created_by: UUID;
  created_at: ISODateString;
}
