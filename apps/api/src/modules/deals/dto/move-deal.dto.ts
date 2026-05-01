import { IsInt, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

export class MoveDealDto {
  @IsUUID()
  stage_id!: string;

  /**
   * Posição 0-indexed dentro do novo stage. Default: fim da fila (max+1).
   */
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;

  /**
   * Obrigatório SE o stage destino tiver `is_lost = true`. Validação é
   * feita server-side pelo service (precisa fetchar o stage primeiro).
   */
  @IsOptional()
  @IsString()
  @Length(1, 500)
  lost_reason?: string;
}
