import {
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import type { TaskPriority, TaskStatus, TaskType } from '@eclick-active/shared';

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

const TASK_STATUSES: TaskStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'cancelled',
  'overdue',
];

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

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
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsUUID()
  deal_id?: string | null;

  @IsOptional()
  @IsUUID()
  contact_id?: string | null;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  due_date?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
