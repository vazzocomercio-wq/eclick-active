import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { BusinessHoursConfig, WeekdayKey } from '@eclick-active/shared';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class DayScheduleDto {
  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'start deve ser HH:mm (ex: 08:00)' })
  start?: string;

  @IsOptional()
  @IsString()
  @Matches(HHMM, { message: 'end deve ser HH:mm (ex: 18:00)' })
  end?: string;
}

export class UpdateBusinessHoursDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsObject()
  @Type(() => Object)
  schedule?: Partial<Record<WeekdayKey, DayScheduleDto>>;
}

export type { BusinessHoursConfig };
