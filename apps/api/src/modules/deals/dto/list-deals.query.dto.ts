import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class ListDealsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;

  @IsOptional()
  @IsUUID()
  pipeline_id?: string;

  @IsOptional()
  @IsUUID()
  stage_id?: string;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  /** Aceita repetição (?tags=a&tags=b) ou string única. AND match. */
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

  /** Inclui deals fechados (won/lost) na lista. Default: false (só ativos). */
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  include_closed?: boolean;
}
