import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AdIntegrationsController } from './ad-integrations.controller';
import { AdIntegrationsService } from './ad-integrations.service';
import { AdMetricsController } from './ad-metrics.controller';
import { AdsSyncService } from './ads-sync.service';
import { AdsSyncWorker } from './ads-sync.worker';
import { GoogleConnector } from './connectors/google.connector';
import { MetaConnector } from './connectors/meta.connector';
import { GoogleOAuthController } from './oauth/google-oauth.controller';
import { MetaOAuthController } from './oauth/meta-oauth.controller';
import { MetricCatalogService } from './metric-catalog.service';
import { MetricConfigService } from './metric-config.service';
import { AdSignalsController } from './signals/ad-signals.controller';
import { MetricCoverageService } from './signals/metric-coverage.service';
import { SignalDetectorService } from './signals/signal-detector.service';
import { SignalDetectorWorker } from './signals/signal-detector.worker';
import { AdLeadsService } from './webhooks/ad-leads.service';
import { MetaLeadAdsController } from './webhooks/meta-lead.controller';
import { AdCompositionsController } from './publish/ad-compositions.controller';
import { AdCompositionsService } from './publish/ad-compositions.service';
import { MetaPublishService } from './publish/meta-publish.service';
import { AdComplianceService } from './publish/ad-compliance.service';
import { AdAudiencesController } from './publish/ad-audiences.controller';
import { AdAudiencesService } from './publish/ad-audiences.service';
import { MetaAudienceService } from './publish/meta-audience.service';
import { MetaInsightsService } from './publish/meta-insights.service';
import { AdAutopilotController } from './publish/ad-autopilot.controller';
import { AdAutopilotService } from './publish/ad-autopilot.service';

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
  imports: [AuthModule, ContactsModule, ConversationsModule],
  controllers: [
    AdIntegrationsController,
    MetaOAuthController,
    GoogleOAuthController,
    AdMetricsController,
    AdSignalsController,
    MetaLeadAdsController,
    AdCompositionsController,
    AdAudiencesController,
    AdAutopilotController,
  ],
  providers: [
    AdIntegrationsService,
    MetaPublishService,
    AdComplianceService,
    MetaInsightsService,
    AdCompositionsService,
    MetaAudienceService,
    AdAudiencesService,
    AdsSyncService,
    AdsSyncWorker,
    MetaConnector,
    GoogleConnector,
    MetricCatalogService,
    MetricConfigService,
    MetricCoverageService,
    SignalDetectorService,
    SignalDetectorWorker,
    AdLeadsService,
    AdAutopilotService,
  ],
  exports: [
    AdIntegrationsService,
    AdsSyncService,
    MetricCatalogService,
    MetricConfigService,
    MetricCoverageService,
    SignalDetectorService,
    AdLeadsService,
    AdCompositionsService,
    MetaPublishService,
  ],
})
export class AdsModule {}
