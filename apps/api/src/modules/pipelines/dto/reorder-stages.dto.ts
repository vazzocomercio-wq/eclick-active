import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderStagesDto {
  /** IDs dos stages na nova ordem. Won/Lost devem permanecer ao final. */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  stage_ids!: string[];
}
