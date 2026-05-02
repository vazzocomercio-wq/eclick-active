import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { KnowledgeCategory } from '@eclick-active/shared';

const CATEGORIES: KnowledgeCategory[] = [
  'products',
  'pricing',
  'policies',
  'faq',
  'scripts',
  'objections',
  'procedures',
  'general',
];

export class ImportUrlPreviewDto {
  @IsUrl({ require_protocol: true }, { message: 'URL precisa ser http:// ou https://' })
  url!: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;
}

export class ImportUrlConfirmDto {
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 100_000)
  content!: string;

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;
}

export class ImportUrlBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsUrl({ require_protocol: true }, { each: true })
  urls!: string[];

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;
}

export class ImportUrlBatchConfirmItemDto {
  @IsUrl({ require_protocol: true })
  url!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsString()
  @Length(1, 100_000)
  content!: string;
}

export class ImportUrlBatchConfirmDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ImportUrlBatchConfirmItemDto)
  items!: ImportUrlBatchConfirmItemDto[];

  @IsOptional()
  @IsIn(CATEGORIES)
  category?: KnowledgeCategory;
}
