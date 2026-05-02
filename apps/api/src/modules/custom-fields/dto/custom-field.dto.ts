import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CustomFieldEntityType,
  CustomFieldType,
} from '@eclick-active/shared';

const ENTITY_TYPES: CustomFieldEntityType[] = ['contact', 'deal', 'company'];

const FIELD_TYPES: CustomFieldType[] = [
  'text',
  'textarea',
  'number',
  'date',
  'select',
  'multi_select',
  'radio',
  'checkbox',
  'url',
  'address_short',
  'address_full',
  'toggle',
  'phone',
  'email',
];

const TYPES_REQUIRING_OPTIONS: CustomFieldType[] = [
  'select',
  'multi_select',
  'radio',
];

class CustomFieldOptionDto {
  @IsString()
  @Length(1, 100)
  label!: string;

  @IsString()
  @Length(1, 100)
  value!: string;
}

class TaskTriggerDto {
  @IsBoolean()
  enabled!: boolean;

  @IsInt()
  @Min(0)
  offset_days!: number;

  @IsIn(['before', 'after'])
  offset_direction!: 'before' | 'after';

  @IsString()
  @Length(1, 200)
  task_title!: string;

  @IsString()
  @Length(1, 50)
  task_type!: string;
}

// ──────────────────────────────────────────────────────────
// Definitions
// ──────────────────────────────────────────────────────────

export class CreateCustomFieldDto {
  @IsIn(ENTITY_TYPES)
  entity_type!: CustomFieldEntityType;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  group_id?: string | null;

  @IsString()
  @Length(1, 100)
  name!: string;

  @IsIn(FIELD_TYPES)
  field_type!: CustomFieldType;

  /** Obrigatório quando field_type é select/multi_select/radio */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldOptionDto)
  @ArrayMaxSize(100)
  options?: CustomFieldOptionDto[];

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsBoolean()
  is_api_only?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  ai_auto_fill?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => TaskTriggerDto)
  task_trigger?: TaskTriggerDto;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  placeholder?: string;
}

export class UpdateCustomFieldDto {
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  group_id?: string | null;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsIn(FIELD_TYPES)
  field_type?: CustomFieldType;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldOptionDto)
  @ArrayMaxSize(100)
  options?: CustomFieldOptionDto[];

  @IsOptional()
  @IsBoolean()
  is_required?: boolean;

  @IsOptional()
  @IsBoolean()
  is_api_only?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  @IsOptional()
  @IsBoolean()
  ai_auto_fill?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @ValidateNested()
  @Type(() => TaskTriggerDto)
  task_trigger?: TaskTriggerDto | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 200)
  placeholder?: string | null;
}

export class ReorderDefinitionsDto {
  @IsIn(ENTITY_TYPES)
  entity_type!: CustomFieldEntityType;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  field_ids!: string[];
}

// ──────────────────────────────────────────────────────────
// Groups
// ──────────────────────────────────────────────────────────

export class CreateGroupDto {
  @IsIn(ENTITY_TYPES)
  entity_type!: CustomFieldEntityType;

  @IsString()
  @Length(1, 100)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 50)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class UpdateGroupDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(0, 50)
  icon?: string | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class ReorderGroupsDto {
  @IsIn(ENTITY_TYPES)
  entity_type!: CustomFieldEntityType;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  group_ids!: string[];
}

// Helper exposto pra uso no service
export const CUSTOM_FIELD_TYPES_REQUIRING_OPTIONS = TYPES_REQUIRING_OPTIONS;

// Re-export pro código que precisa do conjunto
export { CustomFieldOptionDto, TaskTriggerDto };
