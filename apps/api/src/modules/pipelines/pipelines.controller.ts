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

@UseGuards(AuthGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(
    private readonly pipelines: PipelinesService,
    private readonly stages: StagesService,
  ) {}

  // GET /pipelines
  @Get()
  list(@CurrentUser() user: AuthUser): Promise<PipelineWithStages[]> {
    return this.pipelines.findAll(user.org_id);
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
