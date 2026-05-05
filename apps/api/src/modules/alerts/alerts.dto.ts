import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

// ─────────────────────────────────────────────────────────────
// Managers
// ─────────────────────────────────────────────────────────────

export class CreateAlertManagerDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  /** Aceita E.164 ou só dígitos (mín 8, máx 16). Server normaliza. */
  @IsString()
  @Matches(/^\+?\d{8,16}$/, {
    message: 'phone deve conter 8-16 dígitos (com + opcional)',
  })
  phone!: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  department?: string;

  @IsOptional()
  @IsUUID('4')
  channel_id?: string;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;
}

export class UpdateAlertManagerDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 80)
  department?: string;

  @IsOptional()
  @IsUUID('4')
  channel_id?: string;

  @IsOptional()
  @IsObject()
  preferences?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @IsIn(['active', 'suspended'])
  status?: 'active' | 'suspended';
}

export class ConfirmPhoneDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code deve ter 6 dígitos' })
  code!: string;
}

// ─────────────────────────────────────────────────────────────
// Routing rules
// ─────────────────────────────────────────────────────────────

export class CreateRoutingRuleDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  name?: string;

  /** signal_type específico ou '*' pra catch-all. */
  @IsString()
  @Length(1, 80)
  signal_type!: string;

  @IsOptional()
  @IsString()
  @IsIn(['warning', 'critical'])
  min_severity?: 'warning' | 'critical';

  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  manager_ids!: string[];

  @IsString()
  @IsIn(['immediate', 'digest_8h', 'digest_14h', 'digest_18h', 'weekly'])
  delivery_mode!:
    | 'immediate'
    | 'digest_8h'
    | 'digest_14h'
    | 'digest_18h'
    | 'weekly';

  @IsOptional()
  @IsBoolean()
  business_hours_only?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}

export class UpdateRoutingRuleDto {
  @IsOptional()
  @IsString()
  @Length(0, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  signal_type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['warning', 'critical'])
  min_severity?: 'warning' | 'critical';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  manager_ids?: string[];

  @IsOptional()
  @IsString()
  @IsIn(['immediate', 'digest_8h', 'digest_14h', 'digest_18h', 'weekly'])
  delivery_mode?:
    | 'immediate'
    | 'digest_8h'
    | 'digest_14h'
    | 'digest_18h'
    | 'weekly';

  @IsOptional()
  @IsBoolean()
  business_hours_only?: boolean;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1000)
  priority?: number;
}
