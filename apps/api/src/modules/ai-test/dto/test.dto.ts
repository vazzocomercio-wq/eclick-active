import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateTestSessionDto {
  @IsOptional()
  @IsUUID()
  persona_id?: string;
}

export class SendTestMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}
