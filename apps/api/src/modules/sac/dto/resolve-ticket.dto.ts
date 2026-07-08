import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { SacResolutionType } from '../sac.types';
import { SAC_RESOLUTION_TYPES } from './sac-enums';

export class ResolveTicketDto {
  @IsIn(SAC_RESOLUTION_TYPES as readonly string[])
  resolution_type!: SacResolutionType;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  resolution_notes?: string;
}

export class ReopenTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RateTicketDto {
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: 1 | 2 | 3 | 4 | 5;
}

export class AddNoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

export class LinkOrderDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  query!: string;
}
