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
import type {
  CreateTagDefinitionDto,
  TagDefinition,
  TagEntityType,
  UpdateTagDefinitionDto,
  UpsertTagDefinitionsDto,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { TagsService } from './tags.service';

@UseGuards(AuthGuard)
@Controller('tags')
export class TagsController {
  constructor(private readonly service: TagsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('entity_type') entity_type?: TagEntityType,
    @Query('search') search?: string,
    @Query('category') category?: string,
  ): Promise<TagDefinition[]> {
    return this.service.list(user.org_id, { entity_type, search, category });
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<TagDefinition> {
    return this.service.findById(user.org_id, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTagDefinitionDto,
  ): Promise<TagDefinition> {
    return this.service.create(user.org_id, user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTagDefinitionDto,
  ): Promise<TagDefinition> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.remove(user.org_id, id);
  }

  /**
   * Upsert em batch — usado pelo Concierge IA (e ações de bulk no UI no
   * futuro). Garante que cada slug existe no catálogo, incrementa uso,
   * cria os faltantes com label humanizado.
   */
  @Post('upsert-many')
  @HttpCode(HttpStatus.OK)
  upsertMany(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpsertTagDefinitionsDto,
  ): Promise<TagDefinition[]> {
    if (!dto?.entity_type || !Array.isArray(dto?.slugs)) {
      return Promise.resolve([]);
    }
    return this.service.upsertMany(user.org_id, dto.entity_type, dto.slugs);
  }
}
