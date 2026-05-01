import type { Json, UUID, ISODateString } from './common';
import type {
  CompanySize,
  ContactTemperature,
  ContactSource,
  ContactTimelineEventType,
} from '../enums';

/** Endereço estruturado (companies.address jsonb) */
export interface Address {
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/**
 * Perfis de contato em cada canal (contacts.channel_profiles jsonb).
 * Cada chave é um channel_type; o valor é channel-específico.
 */
export interface ChannelProfiles {
  whatsapp?: { wa_id: string; profile_name?: string };
  instagram?: { ig_id: string; username?: string };
  messenger?: { psid: string; name?: string };
  telegram?: { user_id: string; username?: string };
  email?: { address: string };
  webchat?: { visitor_id: string };
  tiktok?: { user_id: string; username?: string };
  mercadolivre?: { user_id: string; nickname?: string };
}

/**
 * Empresa (B2B). Vinculável a múltiplos contatos.
 * Tabela: active.companies
 */
export interface Company {
  id: UUID;
  org_id: UUID;
  name: string;
  domain: string | null;
  industry: string | null;
  size: CompanySize | null;
  address: Address | null;
  custom_fields: Record<string, unknown>;
  notes: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Lead/cliente — pessoa física com quem a empresa conversa.
 * Tabela: active.contacts
 */
export interface Contact {
  id: UUID;
  org_id: UUID;
  company_id: UUID | null;
  // Identidade
  name: string | null;
  phone: string | null;
  email: string | null;
  avatar_url: string | null;
  // Classificação
  tags: string[];
  source: ContactSource | null;
  // Campos gerados por IA
  /** Resumo auto-gerado deste contato (atualizado em background) */
  ai_summary: string | null;
  temperature: ContactTemperature | null;
  /** Score 0–100, calculado periodicamente */
  score: number;
  // Metadata
  custom_fields: Record<string, unknown>;
  channel_profiles: ChannelProfiles;
  /** Marcado como opt-out global (LGPD) */
  opted_out: boolean;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Linha do tempo de eventos relacionados a um contato (somente leitura, append-only).
 * Tabela: active.contact_timeline
 */
export interface ContactTimelineEvent {
  id: UUID;
  org_id: UUID;
  contact_id: UUID;
  event_type: ContactTimelineEventType;
  title: string | null;
  description: string | null;
  metadata: Json;
  /** null quando o evento veio do sistema/IA */
  created_by: UUID | null;
  created_at: ISODateString;
}
