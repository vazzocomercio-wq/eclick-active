import {
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
} from 'class-validator';

const LOCATION_TYPES = ['online', 'presencial', 'telefone', 'flexivel'] as const;

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
}
