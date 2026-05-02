import type { ISODateString, UUID } from './common';

/**
 * Tipo da entidade que carrega o campo personalizado. Aplica em
 * `contacts.custom_fields`, `deals.custom_fields`, `companies.custom_fields`.
 */
export type CustomFieldEntityType = 'contact' | 'deal' | 'company';

/**
 * Tipo de input. Cada tipo dita o componente renderizado pelo
 * `<CustomFieldRenderer>` no frontend e a validação no backend.
 *
 *   - text, textarea, number, date           — escalares simples
 *   - select, multi_select, radio, checkbox  — usam `options[]`
 *   - url                                    — Input + botões "Visitar"/"Copiar"
 *   - address_short                          — Input livre + link Google Maps
 *   - address_full                           — objeto estruturado com auto-fill ViaCEP
 *   - toggle                                 — Switch (boolean)
 *   - phone                                  — Input com máscara BR
 *   - email                                  — Input type="email"
 */
export type CustomFieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'select'
  | 'multi_select'
  | 'radio'
  | 'checkbox'
  | 'url'
  | 'address_short'
  | 'address_full'
  | 'toggle'
  | 'phone'
  | 'email';

/** Item de uma lista de opções (select/multi_select/radio). */
export interface CustomFieldOption {
  label: string;
  value: string;
}

/**
 * Trigger automático de tarefa pra campos type=date. Quando o agente
 * preenche a data, o backend agenda uma task com offset (ex: 7 dias antes
 * pra "Renovar contrato").
 */
export interface CustomFieldTaskTrigger {
  enabled: boolean;
  /** Quantos dias de offset (sempre positivo; direção controlada por `offset_direction`). */
  offset_days: number;
  /** 'before' = N dias antes da data; 'after' = N dias depois. */
  offset_direction: 'before' | 'after';
  task_title: string;
  /** Deve bater com `TaskType` do shared/enums. */
  task_type: string;
}

/**
 * Endereço estruturado (shape de `custom_fields[key]` quando field_type='address_full').
 */
export interface AddressFullValue {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
}

/**
 * Grupo de campos personalizados — agrupamento opcional no UI.
 * Tabela: active.custom_field_groups
 */
export interface CustomFieldGroup {
  id: UUID;
  org_id: UUID;
  entity_type: CustomFieldEntityType;
  name: string;
  /** Nome do ícone lucide-react (ex: 'briefcase', 'map-pin'). */
  icon: string | null;
  position: number;
  created_at: ISODateString;
}

/**
 * Definição de campo personalizado por org.
 * Tabela: active.custom_field_definitions
 */
export interface CustomFieldDefinition {
  id: UUID;
  org_id: UUID;
  entity_type: CustomFieldEntityType;
  /** null = "Sem grupo" (renderiza no painel "Principal"). */
  group_id: UUID | null;
  name: string;
  field_type: CustomFieldType;
  options: CustomFieldOption[];
  is_required: boolean;
  is_api_only: boolean;
  position: number;
  ai_auto_fill: boolean;
  task_trigger: CustomFieldTaskTrigger | null;
  placeholder: string | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
