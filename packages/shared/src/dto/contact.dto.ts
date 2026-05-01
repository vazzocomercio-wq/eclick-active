import type { UUID } from '../types/common';
import type { ChannelProfiles, Address } from '../types/contact';
import type { ContactSource } from '../enums';

/** Payload de criação de Contact (POST /contacts) */
export interface CreateContactDto {
  name?: string;
  phone?: string;
  email?: string;
  avatar_url?: string;
  company_id?: UUID;
  tags?: string[];
  source?: ContactSource;
  channel_profiles?: ChannelProfiles;
  custom_fields?: Record<string, unknown>;
}

/** Payload de atualização parcial de Contact (PATCH /contacts/:id) */
export type UpdateContactDto = Partial<CreateContactDto>;

/** Payload de criação de Company */
export interface CreateCompanyDto {
  name: string;
  domain?: string;
  industry?: string;
  size?: import('../enums').CompanySize;
  address?: Address;
  custom_fields?: Record<string, unknown>;
  notes?: string;
}

export type UpdateCompanyDto = Partial<CreateCompanyDto>;
