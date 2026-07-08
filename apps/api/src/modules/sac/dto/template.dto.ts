import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class CreateTemplateDto {
  @IsString()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  category?: string | null;

  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateTemplateDto {
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @IsString()
  @MaxLength(60)
  category?: string | null;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  content?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(60, { each: true })
  variables?: string[];

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
