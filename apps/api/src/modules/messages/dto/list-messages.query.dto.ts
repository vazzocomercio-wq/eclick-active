import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class ListMessagesQueryDto {
  /**
   * ISO 8601 timestamp da última mensagem da página anterior. A query traz
   * mensagens com `created_at < cursor`. Sem cursor, traz as mais recentes.
   * Tabela `active.messages` é particionada — cursor é OBRIGATÓRIO no lugar
   * de OFFSET (PostgreSQL não otimiza OFFSET em particionadas).
   */
  @IsOptional()
  @IsISO8601()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;
}
