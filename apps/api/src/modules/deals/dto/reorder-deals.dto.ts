import { ArrayMinSize, IsArray, IsUUID } from 'class-validator';

export class ReorderDealsDto {
  @IsUUID()
  stage_id!: string;

  /**
   * IDs dos deals na nova ordem (0-indexed). Todos devem pertencer ao
   * stage_id informado, à org do user.
   */
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  deal_ids!: string[];
}
