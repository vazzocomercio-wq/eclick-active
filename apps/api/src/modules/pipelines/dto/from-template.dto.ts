import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import {
  PIPELINE_TEMPLATE_KEYS,
  type PipelineTemplateKey,
} from '../pipeline-templates';

export class FromTemplateDto {
  @IsIn(PIPELINE_TEMPLATE_KEYS)
  template!: PipelineTemplateKey;

  /** Nome custom; se omitido usa o `default_name` do template. */
  @IsOptional()
  @IsString()
  @Length(1, 100)
  name?: string;
}

export class DeleteAndMoveStageDto {
  @IsString()
  @Length(36, 36)
  target_stage_id!: string;
}
