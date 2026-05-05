import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdatePipelineDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  /**
   * Descrição livre do pipeline. Usada pela IA do AI Concierge pra rotear
   * leads inteligentemente. Ex: "Pipeline para clientes B2B enterprise,
   * ticket > 50k, ciclo longo".
   */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
