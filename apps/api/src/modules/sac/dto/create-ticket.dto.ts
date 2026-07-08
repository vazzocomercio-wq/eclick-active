import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type {
  SacCategory,
  SacPriority,
  SacDepartment,
} from '../sac.types';
import {
  SAC_CATEGORIES,
  SAC_PRIORITIES,
  SAC_DEPARTMENTS,
} from './sac-enums';

export class CreateTicketDto {
  @IsUUID()
  contact_id!: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string | null;

  @IsOptional()
  @IsIn(SAC_CATEGORIES as readonly string[])
  category?: SacCategory;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  subcategory?: string;

  @IsOptional()
  @IsIn(SAC_PRIORITIES as readonly string[])
  priority?: SacPriority;

  @IsOptional()
  @IsIn(SAC_DEPARTMENTS as readonly string[])
  department?: SacDepartment;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  source_channel?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
