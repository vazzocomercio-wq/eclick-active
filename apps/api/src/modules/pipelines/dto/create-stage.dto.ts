import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

export class CreateStageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /** Hex color #RRGGBB. Default no schema é #00E5FF (cyan da brand). */
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color deve estar no formato #RRGGBB' })
  color?: string;

  /** Probabilidade de fechamento (0-100). */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  /** Máximo de horas que um deal deveria ficar nessa etapa. */
  @IsOptional()
  @IsInt()
  @Min(1)
  sla_hours?: number;

  @IsOptional()
  @IsArray()
  automation_rules?: unknown[];
}
