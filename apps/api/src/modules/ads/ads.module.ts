import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AdIntegrationsController } from './ad-integrations.controller';
import { AdIntegrationsService } from './ad-integrations.service';
import { AdsSyncService } from './ads-sync.service';
import { AdsSyncWorker } from './ads-sync.worker';
import { MetaConnector } from './connectors/meta.connector';
import { MetaOAuthController } from './oauth/meta-oauth.controller';

/**
 * Módulo de Ads — Blocos B + C do Active Intelligence.
 *
 * Bloco B (OAuth + persist):
 *   - AdIntegrationsService — OAuth state, persist, refresh, token resolution
 *   - AdIntegrationsController — GET/DELETE /ad-integrations (auth required)
 *                                + POST /:id/sync trigger manual
 *   - MetaOAuthController — /ad-integrations/meta/{connect,callback}
 *
 * Bloco C (sync):
 *   - MetaConnector — cliente da Marketing API (campaigns + insights)
 *   - AdsSyncService — orquestra connector → DB
 *   - AdsSyncWorker — cron horário pra cada integração ativa
 *
 * Próximos blocos:
 *   - GoogleOAuthController + GoogleConnector (Bloco D)
 *   - MetaLeadAdsController (Bloco F — webhook leadgen)
 *
 * Exporta AdIntegrationsService + AdsSyncService — outros módulos podem
 * pluggar (ex: signal-detector do Bloco G vai ler ad_metrics_daily).
 */
@Module({
  imports: [AuthModule],
  controllers: [AdIntegrationsController, MetaOAuthController],
  providers: [AdIntegrationsService, AdsSyncService, AdsSyncWorker, MetaConnector],
  exports: [AdIntegrationsService, AdsSyncService],
})
export class AdsModule {}
