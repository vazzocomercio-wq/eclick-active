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
import type { AiAgentSkill, AiSkill } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiSkillsService } from './ai-skills.service';
import {
  AttachSkillDto,
  CreateSkillDto,
  ReorderSkillsDto,
  UpdateSkillDto,
} from './dto/skill.dto';

@UseGuards(AuthGuard)
@Controller('ai/skills')
export class AiSkillsController {
  constructor(private readonly service: AiSkillsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AiSkill[]> {
    return this.service.list(user.org_id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiSkill> {
    return this.service.getById(user.org_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateSkillDto,
  ): Promise<AiSkill> {
    return this.service.create(user.org_id, dto, user.id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSkillDto,
  ): Promise<AiSkill> {
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

  @Post('seed')
  @HttpCode(HttpStatus.OK)
  seed(@CurrentUser() user: AuthUser): Promise<{ created: number; skipped: number }> {
    return this.service.seedSystemSkills(user.org_id);
  }
}

@UseGuards(AuthGuard)
@Controller('ai/personas/:personaId/skills')
export class PersonaSkillsController {
  constructor(private readonly service: AiSkillsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Param('personaId', ParseUUIDPipe) personaId: string,
  ) {
    return this.service.listForPersona(user.org_id, personaId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  attach(
    @CurrentUser() user: AuthUser,
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() dto: AttachSkillDto,
  ): Promise<AiAgentSkill> {
    return this.service.attachSkillToPersona(user.org_id, personaId, dto);
  }

  @Delete(':skillId')
  @HttpCode(HttpStatus.NO_CONTENT)
  detach(
    @CurrentUser() user: AuthUser,
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Param('skillId', ParseUUIDPipe) skillId: string,
  ): Promise<void> {
    return this.service.detachSkillFromPersona(user.org_id, personaId, skillId);
  }

  @Put('reorder')
  @HttpCode(HttpStatus.NO_CONTENT)
  reorder(
    @CurrentUser() user: AuthUser,
    @Param('personaId', ParseUUIDPipe) personaId: string,
    @Body() dto: ReorderSkillsDto,
  ): Promise<void> {
    return this.service.reorderPersonaSkills(user.org_id, personaId, dto);
  }
}
