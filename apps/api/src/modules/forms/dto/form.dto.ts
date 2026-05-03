import {
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const STATUSES = ['draft', 'active', 'paused', 'archived'] as const;
const SOURCES = ['link', 'embed', 'qrcode', 'whatsapp', 'api'] as const;

export class CreateFormDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9-]+$/, {
    message: 'Slug deve conter apenas letras minúsculas, números e hífens',
  })
  slug?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsArray()
  fields?: unknown[];

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  template_category?: string;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class UpdateFormDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  @Matches(/^[a-z0-9-]+$/)
  slug?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsArray()
  fields?: unknown[];

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  branding?: Record<string, unknown>;

  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
}

export class SubmitFormDto {
  @IsObject()
  data!: Record<string, unknown>;

  @IsOptional()
  @IsIn(SOURCES)
  source?: (typeof SOURCES)[number];

  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utm_medium?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  utm_content?: string;

  @IsOptional()
  @IsString()
  utm_term?: string;
}
