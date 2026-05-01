import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import type { TaskPriority, TaskType } from '@eclick-active/shared';

const TASK_TYPES: TaskType[] = [
  'call',
  'email',
  'meeting',
  'follow_up',
  'whatsapp',
  'proposal',
  'custom',
];

const TASK_PRIORITIES: TaskPriority[] = ['low', 'normal', 'high', 'urgent'];

export class CreateTaskDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsIn(TASK_TYPES)
  task_type?: TaskType;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @IsUUID()
  deal_id?: string;

  @IsOptional()
  @IsUUID()
  contact_id?: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string;

  @IsUUID()
  assigned_to!: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  due_date?: string;

  @IsOptional()
  @IsBoolean()
  created_by_ai?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  ai_context?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
