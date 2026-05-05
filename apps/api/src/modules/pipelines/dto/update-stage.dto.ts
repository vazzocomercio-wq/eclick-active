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

  /**
   * Descrição livre do stage. Usada pela IA do AI Concierge pra escolher
   * onde encaixar o lead. Ex: "Cliente já demonstrou interesse e tem
   * orçamento aprovado".
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_contact_fields?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_deal_fields?: string[];
}
