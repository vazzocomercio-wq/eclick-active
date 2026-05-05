import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AdIntegrationsController } from './ad-integrations.controller';
import { AdIntegrationsService } from './ad-integrations.service';
import { AdMetricsController } from './ad-metrics.controller';
import { AdsSyncService } from './ads-sync.service';
import { AdsSyncWorker } from './ads-sync.worker';
import { MetaConnector } from './connectors/meta.connector';
import { MetaOAuthController } from './oauth/meta-oauth.controller';
import { MetricCatalogService } from './metric-catalog.service';
import { MetricConfigService } from './metric-config.service';

/**
 * Módulo de Ads — Blocos B + C + E do Active Intelligence.
 *
 * Bloco B (OAuth + persist):
 *   - AdIntegrationsService, AdIntegrationsController, MetaOAuthController
 *
 * Bloco C (sync):
 *   - MetaConnector, AdsSyncService, AdsSyncWorker
 *
 * Bloco E (metric catalog + configs):
 *   - MetricCatalogService — read-only do catálogo curado
 *   - MetricConfigService — CRUD de configs por org com defaults virtuais
 *   - AdMetricsController — GET /ad-metrics/{catalog,configs} + PATCH
 *
 * Próximos blocos:
 *   - GoogleOAuthController + GoogleConnector (Bloco D)
 *   - MetaLeadAdsController (Bloco F — webhook leadgen)
 *   - SignalDetectorService consumindo ad_metric_configs + ad_metrics_daily (G)
 *
 * Exporta serviços que outros módulos vão consumir.
 */
@Module({
  imports: [AuthModule],
  controllers: [AdIntegrationsController, MetaOAuthController, AdMetricsController],
  providers: [
    AdIntegrationsService,
    AdsSyncService,
    AdsSyncWorker,
    MetaConnector,
    MetricCatalogService,
    MetricConfigService,
  ],
  exports: [
    AdIntegrationsService,
    AdsSyncService,
    MetricCatalogService,
    MetricConfigService,
  ],
})
export class AdsModule {}
