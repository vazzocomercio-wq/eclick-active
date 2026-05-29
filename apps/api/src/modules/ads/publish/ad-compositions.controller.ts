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
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import {
  AdCompositionsService,
  CreateCompositionDto,
  GenerateCompositionDto,
} from './ad-compositions.service';
import type { AdComposition, MetaPage } from './ad-compositions.types';

/**
 * Endpoints de composição/publicação de campanhas Meta (Onda 1).
 * Toda ação é org-scoped via AuthGuard + CurrentUser.
 *
 * Segurança: publish/pause/resume mexem em gasto real — o front DEVE
 * confirmar com o user antes de chamar. O backend sempre cria PAUSED.
 */
@UseGuards(AuthGuard)
@Controller('ad-compositions')
export class AdCompositionsController {
  constructor(private readonly service: AdCompositionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
  ): Promise<AdComposition[]> {
    return this.service.list(user.org_id, status);
  }

  /** Páginas do Facebook elegíveis pra assinar anúncios desta conta. */
  @Get('pages/:integrationId')
  pages(
    @CurrentUser() user: AuthUser,
    @Param('integrationId', new ParseUUIDPipe()) integrationId: string,
  ): Promise<MetaPage[]> {
    return this.service.listPages(user.org_id, integrationId);
  }

  @Get(':id')
  get(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdComposition> {
    return this.service.get(user.org_id, id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCompositionDto,
  ): Promise<AdComposition> {
    return this.service.create(user.org_id, user.id, dto);
  }

  /** Gera um rascunho completo com IA a partir de um produto. */
  @Post('generate')
  generate(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateCompositionDto,
  ): Promise<AdComposition> {
    return this.service.generate(user.org_id, user.id, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() patch: Partial<CreateCompositionDto> & { status?: string },
  ): Promise<AdComposition> {
    return this.service.update(user.org_id, id, patch);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.archive(user.org_id, id);
  }

  /** Publica no Meta (cria Campaign+AdSet+Ads PAUSED). */
  @Post(':id/publish')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdComposition> {
    return this.service.publish(user.org_id, id);
  }

  @Post(':id/pause')
  pause(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdComposition> {
    return this.service.pause(user.org_id, id);
  }

  @Post(':id/resume')
  resume(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<AdComposition> {
    return this.service.resume(user.org_id, id);
  }
}
