import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTestSessionDto {
  @IsOptional()
  @IsUUID()
  persona_id?: string;
}

/**
 * Toggles que isolam quais fontes alimentam a IA — usado pelo modo teste
 * pra calibrar qual combinação dá resultado melhor (persona pura vs +KB
 * vs +skill vs +live source vs full).
 */
export class TestSourcesDto {
  @IsOptional()
  @IsBoolean()
  use_kb?: boolean;

  @IsOptional()
  @IsBoolean()
  use_skills?: boolean;

  @IsOptional()
  @IsBoolean()
  use_live?: boolean;
}

export class SendTestMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;

  @IsOptional()
  @Type(() => TestSourcesDto)
  sources?: TestSourcesDto;
}
