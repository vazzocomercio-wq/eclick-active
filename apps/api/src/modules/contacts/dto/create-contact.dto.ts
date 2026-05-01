import {
  IsArray,
  IsEmail,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  CreateContactDto as ICreateContactDto,
  ChannelProfiles,
  ContactSource,
} from '@eclick-active/shared';

const CONTACT_SOURCES: ContactSource[] = [
  'whatsapp',
  'instagram',
  'website',
  'import',
  'manual',
  'referral',
];

export class CreateContactDto implements ICreateContactDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  phone?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @IsOptional()
  @IsString()
  avatar_url?: string;

  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @IsIn(CONTACT_SOURCES)
  source?: ContactSource;

  @IsOptional()
  @IsObject()
  channel_profiles?: ChannelProfiles;

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, unknown>;
}
