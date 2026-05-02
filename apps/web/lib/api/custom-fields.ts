import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
  CustomFieldOption,
  CustomFieldTaskTrigger,
  CustomFieldType,
} from '@eclick-active/shared';
import { api } from './client';

// ──────────────────────────────────────────────────────────
// Inputs
// ──────────────────────────────────────────────────────────

export interface CreateCustomFieldInput {
  entity_type: CustomFieldEntityType;
  group_id?: string | null;
  name: string;
  field_type: CustomFieldType;
  options?: CustomFieldOption[];
  is_required?: boolean;
  is_api_only?: boolean;
  position?: number;
  ai_auto_fill?: boolean;
  task_trigger?: CustomFieldTaskTrigger;
  placeholder?: string;
}

export interface UpdateCustomFieldInput {
  group_id?: string | null;
  name?: string;
  field_type?: CustomFieldType;
  options?: CustomFieldOption[];
  is_required?: boolean;
  is_api_only?: boolean;
  position?: number;
  ai_auto_fill?: boolean;
  task_trigger?: CustomFieldTaskTrigger | null;
  placeholder?: string | null;
}

export interface CreateGroupInput {
  entity_type: CustomFieldEntityType;
  name: string;
  icon?: string;
  position?: number;
}

export interface UpdateGroupInput {
  name?: string;
  icon?: string | null;
  position?: number;
}

// ──────────────────────────────────────────────────────────
// API client
// ──────────────────────────────────────────────────────────

export const customFieldsApi = {
  // Definitions
  list(entityType?: CustomFieldEntityType, signal?: AbortSignal) {
    return api.get<CustomFieldDefinition[]>('/custom-fields', {
      query: { entity_type: entityType },
      signal,
    });
  },
  create(input: CreateCustomFieldInput) {
    return api.post<CustomFieldDefinition>('/custom-fields', input);
  },
  update(id: string, input: UpdateCustomFieldInput) {
    return api.patch<CustomFieldDefinition>(`/custom-fields/${id}`, input);
  },
  remove(id: string) {
    return api.delete<void>(`/custom-fields/${id}`);
  },
  reorder(entityType: CustomFieldEntityType, fieldIds: string[]) {
    return api.put<void>('/custom-fields/reorder', {
      entity_type: entityType,
      field_ids: fieldIds,
    });
  },

  // Groups
  listGroups(entityType?: CustomFieldEntityType, signal?: AbortSignal) {
    return api.get<CustomFieldGroup[]>('/custom-fields/groups', {
      query: { entity_type: entityType },
      signal,
    });
  },
  createGroup(input: CreateGroupInput) {
    return api.post<CustomFieldGroup>('/custom-fields/groups', input);
  },
  updateGroup(id: string, input: UpdateGroupInput) {
    return api.patch<CustomFieldGroup>(`/custom-fields/groups/${id}`, input);
  },
  removeGroup(id: string) {
    return api.delete<void>(`/custom-fields/groups/${id}`);
  },
  reorderGroups(entityType: CustomFieldEntityType, groupIds: string[]) {
    return api.put<void>('/custom-fields/groups/reorder', {
      entity_type: entityType,
      group_ids: groupIds,
    });
  },
};

export type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
  CustomFieldOption,
  CustomFieldTaskTrigger,
  CustomFieldType,
};
