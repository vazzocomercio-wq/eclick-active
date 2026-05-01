import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import type {
  CreateConversationDto as ICreateConversationDto,
  ChannelType,
  ConversationPriority,
} from '@eclick-active/shared';

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

const PRIORITIES: ConversationPriority[] = ['low', 'normal', 'high', 'urgent'];

export class CreateConversationDto implements ICreateConversationDto {
  @IsUUID()
  contact_id!: string;

  @IsOptional()
  @IsUUID()
  channel_id?: string;

  @IsIn(CHANNEL_TYPES)
  channel_type!: ChannelType;

  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: ConversationPriority;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
