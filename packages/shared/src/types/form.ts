import type { ISODateString, UUID } from './common';

export type FormStatus = 'draft' | 'active' | 'paused' | 'archived';
export type FormSubmissionSource = 'link' | 'embed' | 'qrcode' | 'whatsapp' | 'api';

export type FormFieldType =
  | 'text'
  | 'textarea'
  | 'email'
  | 'phone'
  | 'number'
  | 'currency'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'checkbox'
  | 'url'
  | 'cpf_cnpj'
  | 'address'
  | 'file_upload'
  | 'heading'
  | 'divider'
  | 'paragraph';

export type FormFieldMapping =
  | 'name'
  | 'email'
  | 'phone'
  | 'company'
  | 'value'
  | 'notes'
  | 'custom';

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldValidation {
  min_length?: number;
  max_length?: number;
  pattern?: string;
  min?: number;
  max?: number;
}

export interface FormFieldConditional {
  field_id: string;
  operator: 'equals' | 'not_equals' | 'contains';
  value: string;
}

export interface FormField {
  id: string;
  type: FormFieldType;
  label: string;
  placeholder?: string;
  required: boolean;
  mapping?: FormFieldMapping;
  options?: FormFieldOption[];
  validation?: FormFieldValidation;
  conditional?: FormFieldConditional;
  position: number;
  width: 'full' | 'half';
  /** Helper text (para heading/paragraph não usa label, usa content). */
  content?: string;
}

export interface FormSettings {
  pipeline_id?: string;
  stage_id?: string;
  assignment_rule?: 'round_robin' | 'specific' | 'none';
  assigned_to?: string; // org_member.id
  deal_title_template?: string;
  auto_tags?: string[];
  welcome_message?: string;
  welcome_channel_id?: string;
  redirect_url?: string;
  success_message?: string;
  notifications?: {
    email?: string;
    webhook_url?: string;
  };
  /** Auto-create deal mesmo sem pipeline configurado (cria no default). */
  auto_create_deal?: boolean;
}

export interface FormBranding {
  logo_url?: string;
  primary_color?: string;
  background_color?: string;
  font_family?: string;
  custom_css?: string;
  header_text?: string;
  footer_text?: string;
  show_powered_by?: boolean;
}

/**
 * Form completo (admin-only — fields, settings, branding visíveis).
 * Tabela: active.forms
 */
export interface Form {
  id: UUID;
  org_id: UUID;
  name: string;
  slug: string;
  description: string | null;
  fields: FormField[];
  settings: FormSettings;
  branding: FormBranding;
  status: FormStatus;
  template_category: string | null;
  submissions_count: number;
  conversion_rate: number | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Shape da página pública /f/:slug — sem settings sensíveis.
 */
export interface FormPublic {
  id: UUID;
  name: string;
  slug: string;
  description: string | null;
  fields: FormField[];
  branding: FormBranding;
  /** Mensagem de sucesso ou null (caller usa default). */
  success_message: string | null;
  redirect_url: string | null;
}

/**
 * Submissão de form. data é o map { field_id: value }.
 * Tabela: active.form_submissions
 */
export interface FormSubmission {
  id: UUID;
  form_id: UUID;
  org_id: UUID;
  data: Record<string, unknown>;
  contact_id: UUID | null;
  deal_id: UUID | null;
  source: FormSubmissionSource;
  ip_address: string | null;
  user_agent: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  processed: boolean;
  processing_result: Record<string, unknown> | null;
  submitted_at: ISODateString;
}
