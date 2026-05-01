import {
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

const SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export class UpdateOrgDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 60)
  @Matches(SLUG_REGEX, {
    message: 'slug deve ter apenas letras minúsculas, números e hífens',
  })
  slug?: string;
}

export class UpdateAiFeatureDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  provider?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}
