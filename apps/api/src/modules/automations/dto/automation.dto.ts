import {
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type { AutomationTriggerType } from '@eclick-active/shared';

const TRIGGER_TYPES: AutomationTriggerType[] = [
  'message_received',
  'deal_created',
  'deal_stage_changed',
  'contact_created',
  'task_overdue',
  'time_based',
  'manual',
  'webhook',
];

export class CreateAutomationDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsIn(TRIGGER_TYPES)
  trigger_type!: AutomationTriggerType;

  @IsOptional()
  @IsObject()
  trigger_config?: Record<string, unknown>;

  @IsArray()
  actions!: Array<Record<string, unknown>>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  natural_language_source?: string;

  /**
   * Vincula a automação a um stage do funil. Quando setado, só dispara
   * pra deals NESTE stage. Null = automação global. Migration 011.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  stage_id?: string | null;
}

export class UpdateAutomationDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsIn(TRIGGER_TYPES)
  trigger_type?: AutomationTriggerType;

  @IsOptional()
  @IsObject()
  trigger_config?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  actions?: Array<Record<string, unknown>>;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  stage_id?: string | null;
}

export class GenerateAutomationDto {
  @IsString()
  @Length(10, 2000)
  description!: string;
}
