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
import { AdSignalsController } from './signals/ad-signals.controller';
import { SignalDetectorService } from './signals/signal-detector.service';
import { SignalDetectorWorker } from './signals/signal-detector.worker';

/**
 * Módulo de Ads — Blocos B + C + E + G do Active Intelligence.
 *
 * B — OAuth + persist (AdIntegrationsService, MetaOAuthController)
 * C — sync (MetaConnector, AdsSyncService, AdsSyncWorker)
 * E — metric catalog + configs (MetricCatalogService, MetricConfigService)
 * G — signal detector (SignalDetectorService, SignalDetectorWorker,
 *     AdSignalsController) — 3 camadas: regras determinísticas,
 *     anomaly detection, sinais compostos hardcoded.
 *
 * Próximos blocos:
 *   - GoogleOAuthController + GoogleConnector (Bloco D — bloqueado)
 *   - MetaLeadAdsController (Bloco F)
 *   - AlertEngine consumindo ad_signals pendentes (Bloco H)
 *
 * Exporta serviços consumidos por outros módulos.
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AdIntegrationsController,
    MetaOAuthController,
    AdMetricsController,
    AdSignalsController,
  ],
  providers: [
    AdIntegrationsService,
    AdsSyncService,
    AdsSyncWorker,
    MetaConnector,
    MetricCatalogService,
    MetricConfigService,
    SignalDetectorService,
    SignalDetectorWorker,
  ],
  exports: [
    AdIntegrationsService,
    AdsSyncService,
    MetricCatalogService,
    MetricConfigService,
    SignalDetectorService,
  ],
})
export class AdsModule {}
