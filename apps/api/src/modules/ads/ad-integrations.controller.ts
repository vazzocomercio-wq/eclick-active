import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import {
  AdIntegrationPublic,
  AdIntegrationsService,
} from './ad-integrations.service';
import { AdsSyncService, SyncResult } from './ads-sync.service';

/**
 * CRUD-lite de integrações conectadas. UI de /configuracoes > Integrações
 * usa estes endpoints. OAuth flow fica nos controllers específicos por
 * plataforma (meta-oauth.controller, futuro google-oauth.controller).
 */
@UseGuards(AuthGuard)
@Controller('ad-integrations')
export class AdIntegrationsController {
  constructor(
    private readonly service: AdIntegrationsService,
    private readonly sync: AdsSyncService,
  ) {}

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

  /**
   * Trigger manual de sync. Roda síncrono (no contexto da request) — pra
   * conta com 90 dias de histórico isso pode demorar 10-30s. UI deve
   * mostrar spinner.
   * Pra agendado, usa AdsSyncWorker (cron horário).
   */
  @Post(':id/sync')
  async syncManual(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<SyncResult> {
    // Garante que a integração pertence à org do user (defesa em
    // profundidade — RLS já filtra, mas service-role-client ignora RLS)
    const list = await this.service.list(user.org_id);
    if (!list.some((i) => i.id === id)) {
      throw new Error('Integração não encontrada nesta organização.');
    }
    return this.sync.syncIntegration(id, 7);
  }
}
