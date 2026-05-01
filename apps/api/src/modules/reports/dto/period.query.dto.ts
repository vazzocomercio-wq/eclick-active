import { IsISO8601, IsOptional } from 'class-validator';

/**
 * Filtros de período usados em todos os relatórios.
 * Default: últimos 30 dias.
 */
export class PeriodQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
