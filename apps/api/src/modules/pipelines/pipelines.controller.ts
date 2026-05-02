import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Pipeline, PipelineStage } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  PipelineWithStages,
  PipelinesService,
} from './pipelines.service';
import { StagesService } from './stages.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { CreateStageDto } from './dto/create-stage.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';
import { DeleteAndMoveStageDto, FromTemplateDto } from './dto/from-template.dto';
import {
  PIPELINE_TEMPLATES,
  type PipelineTemplateMeta,
} from './pipeline-templates';

@UseGuards(AuthGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(
    private readonly pipelines: PipelinesService,
    private readonly stages: StagesService,
  ) {}

  // GET /pipelines/templates  (estático, antes de :id)
  @Get('templates')
  listTemplates(): Array<PipelineTemplateMeta> {
    return Object.values(PIPELINE_TEMPLATES);
  }

  // GET /pipelines?include_archived=true
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('include_archived') includeArchivedRaw?: string,
  ): Promise<PipelineWithStages[]> {
    const includeArchived = includeArchivedRaw === 'true';
    return this.pipelines.findAll(user.org_id, { includeArchived });
  }

  // POST /pipelines
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePipelineDto,
  ): Promise<Pipeline> {
    return this.pipelines.create(user.org_id, dto);
  }

  // POST /pipelines/from-template
  @Post('from-template')
  @HttpCode(HttpStatus.CREATED)
  createFromTemplate(
    @CurrentUser() user: AuthUser,
    @Body() dto: FromTemplateDto,
  ): Promise<PipelineWithStages> {
    return this.pipelines.createFromTemplate(user.org_id, dto.template, dto.name);
  }

  // POST /pipelines/:id/archive
  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  archive(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Pipeline> {
    return this.pipelines.archive(user.org_id, id);
  }

  // POST /pipelines/:id/restore
  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  restore(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Pipeline> {
    return this.pipelines.restore(user.org_id, id);
  }

  // POST /pipelines/:id/stages/:stageId/delete-and-move
  @Post(':id/stages/:stageId/delete-and-move')
  @HttpCode(HttpStatus.OK)
  deleteAndMoveStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) pipelineId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: DeleteAndMoveStageDto,
  ): Promise<{ moved: number }> {
    return this.pipelines.deleteStageAndMoveDeals(
      user.org_id,
      pipelineId,
      stageId,
      dto.target_stage_id,
    );
  }

  // GET /pipelines/:id
  @Get(':id')
  detail(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PipelineWithStages> {
    return this.pipelines.findById(user.org_id, id);
  }

  // PATCH /pipelines/:id
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePipelineDto,
  ): Promise<Pipeline> {
    return this.pipelines.update(user.org_id, id, dto);
  }

  // DELETE /pipelines/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pipelines.delete(user.org_id, id);
  }

  // ──────────────────────────────────────────────────────────
  // Stages — sub-recurso de pipeline
  // ──────────────────────────────────────────────────────────

  // PUT /pipelines/:id/stages/reorder  (definido ANTES de :id/stages/:stageId
  // pra clareza, embora HTTP method diferente já evite conflito)
  @Put(':id/stages/reorder')
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) pipelineId: string,
    @Body() dto: ReorderStagesDto,
  ): Promise<PipelineStage[]> {
    return this.stages.reorderStages(user.org_id, pipelineId, dto.stage_ids);
  }

  // POST /pipelines/:id/stages
  @Post(':id/stages')
  @HttpCode(HttpStatus.CREATED)
  createStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) pipelineId: string,
    @Body() dto: CreateStageDto,
  ): Promise<PipelineStage> {
    return this.stages.createStage(user.org_id, pipelineId, dto);
  }

  // PATCH /pipelines/:id/stages/:stageId
  @Patch(':id/stages/:stageId')
  updateStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) _pipelineId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
    @Body() dto: UpdateStageDto,
  ): Promise<PipelineStage> {
    return this.stages.updateStage(user.org_id, stageId, dto);
  }

  // DELETE /pipelines/:id/stages/:stageId
  @Delete(':id/stages/:stageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteStage(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) _pipelineId: string,
    @Param('stageId', ParseUUIDPipe) stageId: string,
  ): Promise<void> {
    return this.stages.deleteStage(user.org_id, stageId);
  }
}
