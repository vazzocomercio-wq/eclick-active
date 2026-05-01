import {
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { ContactTemperature } from '@eclick-active/shared';

const TEMPERATURES: ContactTemperature[] = ['cold', 'warm', 'hot', 'very_hot'];

export class ListContactsQueryDto {
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
  @IsString()
  @MaxLength(200)
  search?: string;

  @IsOptional()
  @IsIn(TEMPERATURES)
  temperature?: ContactTemperature;

  /**
   * Aceita repetição (?tags=a&tags=b) ou string única (?tags=a) — class-transformer
   * normaliza pra array. Filtro aplica AND (contato precisa ter TODAS as tags).
   */
  @IsOptional()
  @Transform(({ value }: { value: string | string[] }) =>
    Array.isArray(value) ? value : [value],
  )
  @IsArray()
  @IsString({ each: true })
  tags?: string[];
}
