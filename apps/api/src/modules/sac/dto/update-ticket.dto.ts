import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import type {
  SacCategory,
  SacPriority,
  SacStatus,
  SacDepartment,
  SacReputationRisk,
} from '../sac.types';
import {
  SAC_CATEGORIES,
  SAC_PRIORITIES,
  SAC_STATUSES,
  SAC_DEPARTMENTS,
  SAC_REPUTATION_RISKS,
} from './sac-enums';

export class UpdateTicketDto {
  @IsOptional()
  @IsIn(SAC_STATUSES as readonly string[])
  status?: SacStatus;

  @IsOptional()
  @IsIn(SAC_PRIORITIES as readonly string[])
  priority?: SacPriority;

  @IsOptional()
  @IsIn(SAC_CATEGORIES as readonly string[])
  category?: SacCategory;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(120)
  subcategory?: string | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsIn(SAC_DEPARTMENTS as readonly string[])
  department?: SacDepartment | null;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigned_to?: string | null;

  @IsOptional()
  @IsIn(SAC_REPUTATION_RISKS as readonly string[])
  reputation_risk_level?: SacReputationRisk;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  tags?: string[];
}

export class AssignTicketDto {
  @IsUUID()
  agent_id!: string;
}

export class EscalateTicketDto {
  @IsUUID()
  to_agent_id!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
