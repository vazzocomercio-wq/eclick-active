import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class InitiateTransferDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @IsOptional()
  @IsUUID()
  target_user_id?: string;

  @IsOptional()
  @IsBoolean()
  ask_permission?: boolean;
}
