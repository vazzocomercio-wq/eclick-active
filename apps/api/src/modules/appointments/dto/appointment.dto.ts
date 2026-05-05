import {
  IsBooleanString,
  IsDateString,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Type } from 'class-transformer';

const STATUSES = [
  'scheduled',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
  'rescheduled',
] as const;

const LOCATION_TYPES = ['online', 'presencial', 'telefone', 'flexivel'] as const;

export class CreateAppointmentDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsISO8601()
  start_time!: string;

  @IsISO8601()
  end_time!: string;

  @IsOptional()
  @IsUUID()
  appointment_type_id?: string;

  @IsOptional()
  @IsUUID()
  contact_id?: string;

  @IsOptional()
  @IsUUID()
  deal_id?: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsIn(LOCATION_TYPES)
  location_type?: (typeof LOCATION_TYPES)[number];

  @IsOptional()
  @IsString()
  @Length(0, 500)
  location_details?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;

  /**
   * Valores dos campos customizados definidos em
   * appointment_type.custom_fields_schema. Validado contra o schema no
   * service. Persistido em appointment.metadata.custom_fields.
   */
  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, unknown>;
}

export class UpdateAppointmentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @IsOptional()
  @IsISO8601()
  start_time?: string;

  @IsOptional()
  @IsISO8601()
  end_time?: string;

  @IsOptional()
  @IsUUID()
  appointment_type_id?: string;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsIn(LOCATION_TYPES)
  location_type?: (typeof LOCATION_TYPES)[number];

  @IsOptional()
  @IsString()
  location_details?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class CancelAppointmentDto {
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}

export class RescheduleAppointmentDto {
  @IsISO8601()
  start_time!: string;

  @IsOptional()
  @IsISO8601()
  end_time?: string;
}

export class ListAppointmentsQueryDto {
  @IsOptional()
  @IsUUID()
  agent_id?: string;

  @IsOptional()
  @IsUUID()
  contact_id?: string;

  @IsOptional()
  @IsUUID()
  deal_id?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @IsBooleanString()
  mine?: string;
}

export class GetSlotsQueryDto {
  @IsDateString()
  date!: string;

  @IsOptional()
  @IsUUID()
  agent_id?: string;

  @IsOptional()
  @IsUUID()
  type_id?: string;
}

export class CalendarRangeQueryDto {
  @IsDateString()
  from!: string;

  @IsDateString()
  to!: string;

  @IsOptional()
  @IsUUID()
  agent_id?: string;
}
