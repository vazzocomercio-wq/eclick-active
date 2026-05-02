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
  UseGuards,
} from '@nestjs/common';
import type { AiAgentPersona } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiPersonaService } from './ai-persona.service';
import { CreatePersonaDto, UpdatePersonaDto } from './dto/persona.dto';

@UseGuards(AuthGuard)
@Controller('ai/personas')
export class AiPersonaController {
  constructor(private readonly service: AiPersonaService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AiAgentPersona[]> {
    return this.service.list(user.org_id);
  }

  @Get('default')
  getDefault(@CurrentUser() user: AuthUser): Promise<AiAgentPersona | null> {
    return this.service.getDefault(user.org_id);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiAgentPersona> {
    return this.service.getById(user.org_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePersonaDto,
  ): Promise<AiAgentPersona> {
    return this.service.create(user.org_id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonaDto,
  ): Promise<AiAgentPersona> {
    return this.service.update(user.org_id, id, dto);
  }

  @Post(':id/set-default')
  @HttpCode(HttpStatus.OK)
  setDefault(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiAgentPersona> {
    return this.service.setDefault(user.org_id, id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }
}
