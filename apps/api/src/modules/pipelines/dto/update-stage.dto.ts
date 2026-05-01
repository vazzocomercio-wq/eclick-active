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

export class UpdateStageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR, { message: 'color deve estar no formato #RRGGBB' })
  color?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  probability?: number;

  /** null permitido pra remover SLA. */
  @IsOptional()
  @IsInt()
  @Min(1)
  sla_hours?: number | null;

  @IsOptional()
  @IsArray()
  automation_rules?: unknown[];
}
