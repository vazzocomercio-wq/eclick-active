import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AdsModule } from '../ads/ads.module';
import { MetaConnector } from '../ads/connectors/meta.connector';
import { AdProviderDispatcher } from './ad-provider.dispatcher';
import { AdsAccountsService } from './ads-accounts.service';
import { AdsAgentController } from './ads-agent.controller';
import { AdsAgentWorker } from './ads-agent.worker';
import { AdsIngestService } from './ads-ingest.service';
import { AdsDecisionsService } from './ads-decisions.service';
import { AdsOverviewService } from './ads-overview.service';
import { AdsDossierService } from './analysis/ads-dossier.service';
import { AdsAnalyzeService } from './analysis/ads-analyze.service';
import { MetaProvider } from './providers/meta.provider';

/**
 * Ads Performance Agent (F12) — motor de OTIMIZAÇÃO de anúncios
 * platform-agnostic. MVP-1: ingestão read-only (SYNC entidades + INGEST
 * insights) via AdProvider/MetaProvider, persistindo no schema canônico
 * active.ads_*.
 *
 * Reusa do módulo `ads` (importado): AdIntegrationsService (resolve token
 * cifrado) e o MetaConnector (cliente Graph v21, re-provido aqui por ser
 * stateless). Não duplica OAuth nem HTTP.
 *
 * Próximos: ANALYZE (LlmService) + fila de decisões (MVP-2), applyAction +
 * guardrails + outcomes + KB vetorizada (MVP-3), modo auto (MVP-4),
 * 2º adaptador TikTok/ML (F12.2).
 */
@Module({
  imports: [AuthModule, AdsModule],
  controllers: [AdsAgentController],
  providers: [
    MetaConnector,
    MetaProvider,
    AdProviderDispatcher,
    AdsAccountsService,
    AdsIngestService,
    AdsDossierService,
    AdsAnalyzeService,
    AdsDecisionsService,
    AdsOverviewService,
    AdsAgentWorker,
  ],
  exports: [
    AdProviderDispatcher,
    AdsIngestService,
    AdsAccountsService,
    AdsAnalyzeService,
    AdsDecisionsService,
  ],
})
export class AdsAgentModule {}
