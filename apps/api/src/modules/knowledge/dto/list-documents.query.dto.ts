import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import type { KnowledgeCategory } from '@eclick-active/shared';

const CATEGORIES: KnowledgeCategory[] = [
  'general',
  'products',
  'pricing',
  'policies',
  'faq',
  'scripts',
  'objections',
  'procedures',
];

export class ListDocumentsQueryDto {
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
  limit: number = 50;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  search?: string;
}
