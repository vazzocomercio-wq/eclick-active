import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export type FeedbackKind = 'positive' | 'negative';

const FEEDBACK_KINDS: FeedbackKind[] = ['positive', 'negative'];

export class FeedbackDto {
  @IsIn(FEEDBACK_KINDS)
  feedback!: FeedbackKind;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}
