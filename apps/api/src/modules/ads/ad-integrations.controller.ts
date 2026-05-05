import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AdIntegrationPublic,
  AdIntegrationsService,
} from './ad-integrations.service';

/**
 * CRUD-lite de integrações conectadas. UI de /configuracoes > Integrações
 * usa estes endpoints. OAuth flow fica nos controllers específicos por
 * plataforma (meta-oauth.controller, futuro google-oauth.controller).
 */
@UseGuards(AuthGuard)
@Controller('ad-integrations')
export class AdIntegrationsController {
  constructor(private readonly service: AdIntegrationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser): Promise<AdIntegrationPublic[]> {
    return this.service.list(user.org_id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    await this.service.disconnect(user.org_id, user.role, id);
  }
}
