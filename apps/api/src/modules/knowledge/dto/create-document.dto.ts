import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
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

export class CreateDocumentDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;

  @IsString()
  @Length(1, 50_000)
  content!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdateDocumentDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;

  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  content?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}
