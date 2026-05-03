import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsMilitaryTime,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AvailabilityDayDto {
  @IsInt()
  @Min(0)
  @Max(6)
  day_of_week!: number;

  @IsMilitaryTime()
  start_time!: string;

  @IsMilitaryTime()
  end_time!: string;

  @IsOptional()
  @IsBoolean()
  is_available?: boolean;
}

export class SetAvailabilityDto {
  @IsUUID()
  agent_id!: string;

  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  schedule!: AvailabilityDayDto[];
}

export class SetDateOverrideDto {
  @IsUUID()
  agent_id!: string;

  @IsDateString()
  date!: string;

  @IsBoolean()
  is_available!: boolean;

  @IsOptional()
  @IsMilitaryTime()
  start_time?: string;

  @IsOptional()
  @IsMilitaryTime()
  end_time?: string;
}
