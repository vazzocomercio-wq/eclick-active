import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

const ISO_4217 = /^[A-Z]{3}$/;

/**
 * Update parcial. Não permite mudar pipeline_id ou stage_id (use
 * MoveDealDto / move endpoint).
 */
export class UpdateDealDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;

  @IsOptional()
  @IsString()
  @Matches(ISO_4217, { message: 'currency precisa ser um código ISO 4217' })
  currency?: string;

  /** ISO 8601 ou null pra limpar. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsISO8601({ strict: true })
  expected_close_date?: string | null;

  /** UUID do agente atribuído ou null pra desatribuir. */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  assigned_to?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, unknown>;

  /**
   * UUID da conversa vinculada — usado pelo Deal Detail Sheet pra ligar
   * conversa existente do contato ao deal. Null pra desvincular.
   */
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsUUID()
  conversation_id?: string | null;
}
