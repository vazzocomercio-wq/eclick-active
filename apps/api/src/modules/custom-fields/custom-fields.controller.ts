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
import type {
  CustomFieldDefinition,
  CustomFieldEntityType,
  CustomFieldGroup,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CustomFieldsService } from './custom-fields.service';
import {
  CreateCustomFieldDto,
  CreateGroupDto,
  ReorderDefinitionsDto,
  ReorderGroupsDto,
  UpdateCustomFieldDto,
  UpdateGroupDto,
} from './dto/custom-field.dto';

const VALID_ENTITY_TYPES: CustomFieldEntityType[] = ['contact', 'deal', 'company'];

function parseEntityType(raw?: string): CustomFieldEntityType | undefined {
  if (!raw) return undefined;
  return VALID_ENTITY_TYPES.includes(raw as CustomFieldEntityType)
    ? (raw as CustomFieldEntityType)
    : undefined;
}

@UseGuards(AuthGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  // ────────────────────────────────────────────
  // GROUPS
  // (Definidos ANTES das rotas dinâmicas /:id pra evitar colisão)
  // ────────────────────────────────────────────

  // PUT /custom-fields/groups/reorder
  @Put('groups/reorder')
  @HttpCode(HttpStatus.OK)
  reorderGroups(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReorderGroupsDto,
  ): Promise<void> {
    return this.service.reorderGroups(user.org_id, user.role, dto);
  }

  // GET /custom-fields/groups?entity_type=
  @Get('groups')
  listGroups(
    @CurrentUser() user: AuthUser,
    @Query('entity_type') entityType?: string,
  ): Promise<CustomFieldGroup[]> {
    return this.service.getGroups(user.org_id, parseEntityType(entityType));
  }

  // POST /custom-fields/groups
  @Post('groups')
  @HttpCode(HttpStatus.CREATED)
  createGroup(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateGroupDto,
  ): Promise<CustomFieldGroup> {
    return this.service.createGroup(user.org_id, user.role, dto);
  }

  // PATCH /custom-fields/groups/:id
  @Patch('groups/:id')
  @HttpCode(HttpStatus.OK)
  updateGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateGroupDto,
  ): Promise<CustomFieldGroup> {
    return this.service.updateGroup(user.org_id, user.role, id, dto);
  }

  // DELETE /custom-fields/groups/:id
  @Delete('groups/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeGroup(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteGroup(user.org_id, user.role, id);
  }

  // ────────────────────────────────────────────
  // DEFINITIONS
  // ────────────────────────────────────────────

  // PUT /custom-fields/reorder
  @Put('reorder')
  @HttpCode(HttpStatus.OK)
  reorderDefinitions(
    @CurrentUser() user: AuthUser,
    @Body() dto: ReorderDefinitionsDto,
  ): Promise<void> {
    return this.service.reorderDefinitions(user.org_id, user.role, dto);
  }

  // GET /custom-fields?entity_type=
  @Get()
  listDefinitions(
    @CurrentUser() user: AuthUser,
    @Query('entity_type') entityType?: string,
  ): Promise<CustomFieldDefinition[]> {
    return this.service.getDefinitions(user.org_id, parseEntityType(entityType));
  }

  // POST /custom-fields
  @Post()
  @HttpCode(HttpStatus.CREATED)
  createDefinition(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    return this.service.createDefinition(user.org_id, user.role, dto);
  }

  // PATCH /custom-fields/:id
  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  updateDefinition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCustomFieldDto,
  ): Promise<CustomFieldDefinition> {
    return this.service.updateDefinition(user.org_id, user.role, id, dto);
  }

  // DELETE /custom-fields/:id
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDefinition(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.deleteDefinition(user.org_id, user.role, id);
  }
}
