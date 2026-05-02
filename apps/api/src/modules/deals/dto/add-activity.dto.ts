import { IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import type { DealActivityType } from '@eclick-active/shared';

/**
 * Subset de tipos permitidos via API pública. `stage_changed`, `value_changed`,
 * `assigned`, `task_created` e `score_changed` são auto-gerados por triggers
 * SQL ou serviços internos — não devem ser criáveis pela UI.
 */
const USER_CREATABLE_TYPES: DealActivityType[] = [
  'note_added',
  'email_sent',
  'call_made',
  'meeting_scheduled',
  'proposal_sent',
];

export class AddActivityDto {
  @IsIn(USER_CREATABLE_TYPES)
  activity_type!: DealActivityType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsString()
  @MaxLength(5000)
  description!: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
