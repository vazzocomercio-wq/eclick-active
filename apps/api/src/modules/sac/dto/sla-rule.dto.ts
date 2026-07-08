import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import type {
  SacCategory,
  SacPriority,
} from '../sac.types';
import { SAC_CATEGORIES, SAC_PRIORITIES } from './sac-enums';

// SLA em minutos: teto de 30 dias evita deadlines absurdos por erro de digitação.
const MAX_SLA_MINUTES = 60 * 24 * 30;

export class CreateSlaRuleDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  channel_type?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SAC_CATEGORIES as readonly string[])
  category?: SacCategory | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SAC_PRIORITIES as readonly string[])
  priority?: SacPriority | null;

  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  first_response_minutes!: number;

  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  resolution_minutes!: number;

  @IsOptional()
  @IsBoolean()
  business_hours_only?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateSlaRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  channel_type?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SAC_CATEGORIES as readonly string[])
  category?: SacCategory | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SAC_PRIORITIES as readonly string[])
  priority?: SacPriority | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  first_response_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_SLA_MINUTES)
  resolution_minutes?: number;

  @IsOptional()
  @IsBoolean()
  business_hours_only?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
