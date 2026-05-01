import {
  IsArray,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
  MaxLength,
} from 'class-validator';

const ISO_4217 = /^[A-Z]{3}$/;

export class CreateDealDto {
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsUUID()
  pipeline_id!: string;

  @IsUUID()
  stage_id!: string;

  @IsOptional()
  @IsUUID()
  contact_id?: string;

  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsUUID()
  conversation_id?: string;

  /** Valor em decimal (ex: 1234.56). 0 ou positivo. */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  value?: number;

  /** ISO 4217 (BRL, USD, EUR). Default: BRL */
  @IsOptional()
  @IsString()
  @Matches(ISO_4217, { message: 'currency precisa ser um código ISO 4217 (ex: BRL)' })
  currency?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  expected_close_date?: string;

  @IsOptional()
  @IsUUID()
  assigned_to?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(50, { each: true })
  tags?: string[];

  @IsOptional()
  @IsObject()
  custom_fields?: Record<string, unknown>;
}
