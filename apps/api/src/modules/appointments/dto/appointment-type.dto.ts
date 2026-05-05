import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const LOCATION_TYPES = ['online', 'presencial', 'telefone', 'flexivel'] as const;
const CUSTOM_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'select',
  'date',
  'boolean',
] as const;

/**
 * Definição de um campo customizado a coletar pra esse appointment_type.
 * Validado por class-validator quando o type é create/update via API.
 */
export class CustomFieldDto {
  @IsString()
  @Length(1, 64)
  key!: string;

  @IsString()
  @Length(1, 80)
  label!: string;

  @IsIn(CUSTOM_FIELD_TYPES)
  type!: (typeof CUSTOM_FIELD_TYPES)[number];

  @IsBoolean()
  required!: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  options?: string[];

  @IsOptional()
  @IsString()
  @Length(0, 200)
  placeholder?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  help_text?: string;

  @IsOptional()
  @IsInt()
  min?: number;

  @IsOptional()
  @IsInt()
  max?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(10000)
  max_length?: number;
}

export class CreateAppointmentTypeDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  duration_minutes?: number;

  @IsOptional()
  @IsIn(LOCATION_TYPES)
  location_type?: (typeof LOCATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  location_details?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  buffer_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  min_advance_hours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  max_per_day?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldDto)
  @ArrayMaxSize(20)
  custom_fields_schema?: CustomFieldDto[];
}

export class UpdateAppointmentTypeDto {
  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(480)
  duration_minutes?: number;

  @IsOptional()
  @IsIn(LOCATION_TYPES)
  location_type?: (typeof LOCATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  location_details?: string;

  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  buffer_minutes?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  min_advance_hours?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  max_per_day?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CustomFieldDto)
  @ArrayMaxSize(20)
  custom_fields_schema?: CustomFieldDto[];
}
