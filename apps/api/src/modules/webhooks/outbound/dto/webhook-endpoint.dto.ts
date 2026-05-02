import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateIf,
} from 'class-validator';
import { WEBHOOK_EVENT_TYPES, type WebhookEventType } from '@eclick-active/shared';

export class CreateWebhookEndpointDto {
  @IsString()
  @Length(1, 100)
  name!: string;

  @IsUrl({ require_protocol: true, require_tld: false })
  url!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  events!: WebhookEventType[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(8, 200)
  secret?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateWebhookEndpointDto {
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true, require_tld: false })
  url?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(WEBHOOK_EVENT_TYPES, { each: true })
  events?: WebhookEventType[];

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @Length(8, 200)
  secret?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
