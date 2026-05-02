import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateIf,
} from 'class-validator';
import type {
  UpdateConversationDto as IUpdateConversationDto,
  ConversationStatus,
  ConversationPriority,
} from '@eclick-active/shared';

const STATUSES: ConversationStatus[] = [
  'open',
  'pending',
  'snoozed',
  'resolved',
  'closed',
  'archived',
];

const PRIORITIES: ConversationPriority[] = ['low', 'normal', 'high', 'urgent'];

export class UpdateConversationDto implements IUpdateConversationDto {
  @IsOptional()
  @IsIn(STATUSES)
  status?: ConversationStatus;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: ConversationPriority;

  /** null permitido pra desatribuir; UUID pra atribuir */
  @IsOptional()
  @ValidateIf((_o, value) => value !== null)
  @IsUUID()
  assigned_to?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, unknown>;
}
