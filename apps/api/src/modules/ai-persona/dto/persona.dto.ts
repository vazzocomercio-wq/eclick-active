import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type {
  AiPersonaResponseLength,
  AiPersonaRole,
  AiPersonaTone,
} from '@eclick-active/shared';

const ROLES: AiPersonaRole[] = [
  'sales_assistant',
  'support_agent',
  'receptionist',
  'custom',
];
const TONES: AiPersonaTone[] = ['formal', 'semiformal', 'casual', 'friendly'];
const LENGTHS: AiPersonaResponseLength[] = ['short', 'medium', 'detailed'];

export class CreatePersonaDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @IsUrl(undefined, { message: 'avatar_url precisa ser uma URL válida' })
  avatar_url?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: AiPersonaRole;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personality?: string;

  @IsOptional()
  @IsIn(TONES)
  tone?: AiPersonaTone;

  @IsOptional()
  @IsIn(LENGTHS)
  response_length?: AiPersonaResponseLength;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  response_delay_seconds?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  guidelines?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forbidden_topics?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  greeting_message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  fallback_message?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}

export class UpdatePersonaDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name?: string;

  @IsOptional()
  @IsString()
  @IsUrl(undefined, { message: 'avatar_url precisa ser uma URL válida' })
  avatar_url?: string;

  @IsOptional()
  @IsIn(ROLES)
  role?: AiPersonaRole;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personality?: string;

  @IsOptional()
  @IsIn(TONES)
  tone?: AiPersonaTone;

  @IsOptional()
  @IsIn(LENGTHS)
  response_length?: AiPersonaResponseLength;

  @IsOptional()
  @IsString()
  language?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(60)
  response_delay_seconds?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  guidelines?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  forbidden_topics?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  greeting_message?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  fallback_message?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
