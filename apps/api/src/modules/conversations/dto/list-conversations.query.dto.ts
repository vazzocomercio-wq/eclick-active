import { IsBooleanString, IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  ChannelType,
  ConversationPriority,
  ConversationStatus,
} from '@eclick-active/shared';

const STATUSES: ConversationStatus[] = ['open', 'pending', 'snoozed', 'resolved', 'closed'];
const PRIORITIES: ConversationPriority[] = ['low', 'normal', 'high', 'urgent'];
const CHANNEL_TYPES: ChannelType[] = [
  'whatsapp',
  'instagram',
  'messenger',
  'telegram',
  'email',
  'webchat',
  'tiktok',
  'mercadolivre',
];

export class ListConversationsQueryDto {
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
  limit: number = 25;

  @IsOptional()
  @IsIn(STATUSES)
  status?: ConversationStatus;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: ConversationPriority;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsIn(CHANNEL_TYPES)
  channel_type?: ChannelType;

  /**
   * Quando 'true', filtra somente conversas atribuídas ao usuário autenticado
   * (ignora `assigned_to` se vier no mesmo request).
   */
  @IsOptional()
  @IsBooleanString()
  mine?: string;
}
