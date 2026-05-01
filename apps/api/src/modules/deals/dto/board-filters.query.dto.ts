import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { DealRisk } from '@eclick-active/shared';

const DEAL_RISKS: DealRisk[] = ['low', 'medium', 'high', 'critical'];

/**
 * Filtros opcionais aplicados em GET /pipelines/:id/board.
 * Todos client-side query params; a query SQL aplica eq/gte/lte/contains.
 */
export class BoardFiltersDto {
  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  /** Aceita repetição (?tags=a&tags=b) ou string única. AND match (contains). */
  @IsOptional()
  @Transform(({ value }: { value: string | string[] }) =>
    Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  min_value?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  max_value?: number;

  /** ai_risk = high|critical filtra por "em risco" (atalho do front) */
  @IsOptional()
  @IsIn(DEAL_RISKS)
  risk?: DealRisk;
}
