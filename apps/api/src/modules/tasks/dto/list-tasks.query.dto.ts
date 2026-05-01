import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
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

export class ListTasksQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsIn(TASK_STATUSES)
  status?: TaskStatus;

  @IsOptional()
  @IsIn(TASK_PRIORITIES)
  priority?: TaskPriority;

  @IsOptional()
  @IsIn(TASK_TYPES)
  task_type?: TaskType;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsUUID()
  deal_id?: string;

  @IsOptional()
  @IsUUID()
  contact_id?: string;

  /** Inclusive — tarefas com due_date >= due_from */
  @IsOptional()
  @IsISO8601({ strict: true })
  due_from?: string;

  /** Inclusive — tarefas com due_date <= due_to */
  @IsOptional()
  @IsISO8601({ strict: true })
  due_to?: string;

  /** Filtro especial: only tarefas overdue (status pending/in_progress + due_date < now) */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  only_overdue?: boolean;

  /** mine=true filtra por current user (assigned_to = current). Sobrescreve assigned_to */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  mine?: boolean;
}
