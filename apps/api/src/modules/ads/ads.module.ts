import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AdIntegrationsController } from './ad-integrations.controller';
import { AdIntegrationsService } from './ad-integrations.service';
import { MetaOAuthController } from './oauth/meta-oauth.controller';

/**
 * Módulo de Ads — Bloco B do Active Intelligence.
 *
 * Contém:
 *   - AdIntegrationsService — OAuth state, persist, refresh, token resolution
 *   - AdIntegrationsController — GET/DELETE /ad-integrations (auth required)
 *   - MetaOAuthController — /ad-integrations/meta/{connect,callback}
 *
 * Próximos blocos vão adicionar:
 *   - GoogleOAuthController (Bloco D)
 *   - MetaConnector + GoogleConnector + AdsSyncWorker (Bloco C/D)
 *   - MetaLeadAdsController (Bloco F — webhook leadgen)
 *
 * Exporta AdIntegrationsService pra ser injetado pelos connectors do C/D.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdIntegrationsController, MetaOAuthController],
  providers: [AdIntegrationsService],
  exports: [AdIntegrationsService],
})
export class AdsModule {}
