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
  Query,
  UseGuards,
} from '@nestjs/common';
import type { Automation } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AutomationsService,
  type AutomationLogRow,
} from './automations.service';
import {
  CreateAutomationDto,
  GenerateAutomationDto,
  UpdateAutomationDto,
} from './dto/automation.dto';
import type { GeneratedAutomation } from './automation.types';

@UseGuards(AuthGuard)
@Controller('automations')
export class AutomationsController {
  constructor(private readonly service: AutomationsService) {}

  // ──────────────────────────────────────────────────────────
  // POST /automations/generate — IA (declarado ANTES de :id)
  // ──────────────────────────────────────────────────────────

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  generate(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateAutomationDto,
  ): Promise<GeneratedAutomation> {
    return this.service.generateFromNaturalLanguage(user.org_id, dto.description);
  }

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────

  // GET /automations?stage_id=<uuid> — filtra por stage (Funil Digital)
  // GET /automations?global_only=true — só globais
  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('stage_id') stageId?: string,
    @Query('global_only') globalOnly?: string,
  ): Promise<Automation[]> {
    return this.service.findAll(user.org_id, {
      ...(stageId ? { stageId } : {}),
      ...(globalOnly === 'true' ? { globalOnly: true } : {}),
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAutomationDto,
  ): Promise<Automation> {
    return this.service.create(user.org_id, dto, user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Automation> {
    return this.service.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAutomationDto,
  ): Promise<Automation> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }

  @Post(':id/toggle')
  @HttpCode(HttpStatus.OK)
  toggle(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Automation> {
    return this.service.toggle(user.org_id, id);
  }

  @Post(':id/test')
  @HttpCode(HttpStatus.OK)
  test(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ status: string; logs: unknown[] }> {
    return this.service.execute(user.org_id, id, {
      event: 'manual',
      org_id: user.org_id,
    });
  }

  @Get(':id/logs')
  logs(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AutomationLogRow[]> {
    return this.service.getLogs(user.org_id, id);
  }
}
