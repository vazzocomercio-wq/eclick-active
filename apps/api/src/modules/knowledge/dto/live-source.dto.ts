import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';

const SOURCE_TYPES = ['webpage', 'api_endpoint', 'rss_feed'] as const;

export class CreateLiveSourceDto {
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsUrl({ require_protocol: true }, { message: 'URL precisa ser http:// ou https://' })
  url!: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsIn(SOURCE_TYPES)
  source_type?: (typeof SOURCE_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  cache_ttl_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class UpdateLiveSourceDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  url?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsIn(SOURCE_TYPES)
  source_type?: (typeof SOURCE_TYPES)[number];

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(1440)
  cache_ttl_minutes?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
