import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { ChannelsModule as ChannelDispatcherModule } from '../../common/channels/channels.module';
import { AlertsModule } from '../alerts/alerts.module';
import { SocialModule } from '../social/social.module';
import { StudioCortesController } from './studio-cortes.controller';
import { CortesGoogleOAuthController } from './cortes-google-oauth.controller';
import { CortesSourceController } from './cortes-source.controller';
import { StudioCortesService } from './studio-cortes.service';
import { CortesDriveClient } from './cortes-drive.client';
import { CopyRunnerService } from './copy/copy-runner.service';
import { ClippingRunnerService } from './clipping/clipping-runner.service';
import { ClippingWebhookController } from './clipping/clipping-webhook.controller';
import { ClippingReconcilerWorker } from './clipping/clipping-reconciler.worker';
import { VizardProvider } from './clipping/vizard.provider';
import { StorageJanitorWorker } from './janitor/storage-janitor.worker';
import { YouTubeShortsProvider } from './publish/youtube-shorts.provider';
import { CortesYouTubeService } from './publish/cortes-youtube.service';
import { CortesYouTubeOAuthController } from './publish/cortes-youtube-oauth.controller';
import { CortesInstagramService } from './publish/cortes-instagram.service';
import { CortesInstagramOAuthController } from './publish/cortes-instagram-oauth.controller';
import { PublishRunnerService } from './publish/publish-runner.service';
import { PublishWorker } from './publish/publish-worker';
import { ClipMetricsRunnerService } from './publish/clip-metrics-runner.service';
import { ClipMetricsWorker } from './publish/clip-metrics.worker';
import { HeygenBridgeWorker } from './heygen-bridge.worker';
import { CLIPPING_PROVIDER } from './studio-cortes.types';

/**
 * Studio de Cortes (Sprint 1) — upload → Drive → corte (provedor) → copys (IA)
 * → fila de revisão (kanban). Publicação fica pro Sprint 2.
 */
@Module({
  imports: [
    SupabaseModule,
    LlmModule,
    AuthModule,
    ChannelDispatcherModule,
    AlertsModule,
    SocialModule, // Sprint 2: reusa providers IG/TikTok + InstagramInsights + creds
  ],
  controllers: [
    StudioCortesController,
    CortesGoogleOAuthController,
    CortesYouTubeOAuthController,
    CortesInstagramOAuthController,
    CortesSourceController,
    ClippingWebhookController,
  ],
  providers: [
    StudioCortesService,
    CortesDriveClient,
    CopyRunnerService,
    ClippingRunnerService,
    VizardProvider,
    // Provedor de corte pluggable — default Vizard. Trocar aqui pra mudar.
    { provide: CLIPPING_PROVIDER, useExisting: VizardProvider },
    StorageJanitorWorker,
    ClippingReconcilerWorker,
    // Sprint 2 — publicação nativa + métricas
    YouTubeShortsProvider,
    CortesYouTubeService,
    CortesInstagramService,
    PublishRunnerService,
    PublishWorker,
    ClipMetricsRunnerService,
    ClipMetricsWorker,
    // Ponte automática HeyGen → Cortes (gated por CORTES_AUTO_FROM_HEYGEN)
    HeygenBridgeWorker,
  ],
  exports: [StudioCortesService],
})
export class StudioCortesModule {}
