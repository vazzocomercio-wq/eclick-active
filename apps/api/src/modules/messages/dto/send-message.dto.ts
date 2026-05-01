import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import type {
  Json,
  SendMessageDto as ISendMessageDto,
  MessageContentType,
  MessageSenderType,
} from '@eclick-active/shared';

const CONTENT_TYPES: MessageContentType[] = [
  'text',
  'image',
  'audio',
  'video',
  'document',
  'template',
  'location',
  'sticker',
  'reaction',
  'interactive',
  'system',
];

const SENDER_TYPES: MessageSenderType[] = ['contact', 'agent', 'bot', 'system'];

export class SendMessageDto implements ISendMessageDto {
  @IsIn(CONTENT_TYPES)
  content_type!: MessageContentType;

  /**
   * Shape varia por content_type — por enquanto `@IsObject()` só valida que
   * é um objeto não-null em runtime. Tipo declarado como `Json` pra bater
   * com a interface do shared. Validação por content_type específico
   * (ex: text → { body: string }) fica como melhoria futura.
   */
  @IsObject()
  content!: Json;

  @IsOptional()
  @IsIn(SENDER_TYPES)
  sender_type?: MessageSenderType;

  @IsOptional()
  @IsUUID()
  template_id?: string;

  @IsOptional()
  @IsObject()
  template_variables?: Record<string, string>;

  @IsOptional()
  @IsString()
  reply_to_channel_message_id?: string;

  @IsOptional()
  @IsBoolean()
  is_internal_note?: boolean;
}
