import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import type { AiSkillAction } from '@eclick-active/shared';

const ALLOWED_ACTIONS: AiSkillAction[] = [
  'send_message',
  'create_task',
  'create_deal',
  'move_deal',
  'update_contact',
  'assign_conversation',
  'search_knowledge',
];

export class CreateSkillDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsString()
  @Length(1, 500)
  description!: string;

  @IsString()
  @Length(1, 8000)
  system_prompt!: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledge_source_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledge_categories?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(ALLOWED_ACTIONS, { each: true })
  allowed_actions?: AiSkillAction[];

  @IsOptional()
  @IsObject()
  trigger_conditions?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSkillDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(1, 8000)
  system_prompt?: string;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  knowledge_source_ids?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  knowledge_categories?: string[];

  @IsOptional()
  @IsArray()
  @IsIn(ALLOWED_ACTIONS, { each: true })
  allowed_actions?: AiSkillAction[];

  @IsOptional()
  @IsObject()
  trigger_conditions?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class AttachSkillDto {
  @IsUUID()
  skill_id!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class ReorderSkillsDto {
  @IsArray()
  @IsUUID(undefined, { each: true })
  skill_ids!: string[];
}
