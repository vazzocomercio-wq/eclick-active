import {
  IsArray,
  IsIn,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { Transform } from 'class-transformer';
import type { TaskType } from '@eclick-active/shared';

const TASK_TYPES: TaskType[] = [
  'call',
  'email',
  'meeting',
  'follow_up',
  'whatsapp',
  'proposal',
  'custom',
];

export class CalendarTasksQueryDto {
  /** Inicio do range (date ou datetime ISO 8601) */
  @IsISO8601({ strict: false })
  from!: string;

  /** Fim do range (date ou datetime ISO 8601) */
  @IsISO8601({ strict: false })
  to!: string;

  /** Filtrar por responsável especifico */
  @IsOptional()
  @IsUUID()
  user_id?: string;

  /** Multi-select de tipos. Aceita repetido (?task_type=call&task_type=meeting) ou csv (?task_type=call,meeting) */
  @IsOptional()
  @Transform(({ value }) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') return value.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  })
  @IsArray()
  @IsIn(TASK_TYPES, { each: true })
  task_type?: TaskType[];
}
