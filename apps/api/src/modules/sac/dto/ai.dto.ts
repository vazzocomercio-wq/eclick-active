import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

export class ClassifyDto {
  @IsString()
  @MaxLength(8000)
  message!: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(4000, { each: true })
  history?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(40)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  email?: string;
}

export class PerformanceDto {
  @IsOptional()
  @IsIn(['today', 'week', 'month'])
  period?: 'today' | 'week' | 'month';
}
