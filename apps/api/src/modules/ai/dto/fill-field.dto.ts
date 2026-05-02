import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';

const ENTITY_TYPES = ['deal', 'contact', 'company', 'task'] as const;
export type FillFieldEntityType = (typeof ENTITY_TYPES)[number];

export class FillFieldDto {
  @IsIn(ENTITY_TYPES as readonly string[])
  entity_type!: FillFieldEntityType;

  @IsUUID()
  entity_id!: string;

  /** Nome do campo (ex: "ai_summary", "description", custom field name). */
  @IsString()
  @Length(1, 100)
  field_name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  current_value?: string;

  /** Hint de tom/formato pra IA (ex: "informal", "passos numerados"). */
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
}
