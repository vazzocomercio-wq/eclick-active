import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import type { ChannelStatus, ChannelType } from '@eclick-active/shared';

const CHANNEL_TYPES: ChannelType[] = [
  'whatsapp',
  'whatsapp_free',
  'instagram',
  'messenger',
  'telegram',
  'email',
  'webchat',
  'tiktok',
  'mercadolivre',
];

const CHANNEL_STATUSES: ChannelStatus[] = [
  'active',
  'paused',
  'error',
  'pending',
  'disconnected',
];

export class CreateChannelDto {
  @IsIn(CHANNEL_TYPES)
  channel_type!: ChannelType;

  @IsString()
  @Length(1, 100)
  name!: string;

  /**
   * Credenciais opacas — shape varia por provider. Para WhatsApp/Z-API:
   * { instance_id, token }. Validação fina fica no provider-specific code.
   */
  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsString()
  external_id?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateChannelDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  phone_number?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsIn(CHANNEL_STATUSES)
  status?: ChannelStatus;

  @IsOptional()
  @IsBoolean()
  paused?: boolean;
}
