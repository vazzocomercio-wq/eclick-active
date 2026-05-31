import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { ChannelsModule as ChannelDispatcherModule } from '../../common/channels/channels.module';
import { AlertsModule } from '../alerts/alerts.module';
import { StudioCortesController } from './studio-cortes.controller';
import { CortesGoogleOAuthController } from './cortes-google-oauth.controller';
import { StudioCortesService } from './studio-cortes.service';
import { CortesDriveClient } from './cortes-drive.client';
import { CopyRunnerService } from './copy/copy-runner.service';
import { ClippingRunnerService } from './clipping/clipping-runner.service';
import { ClippingWebhookController } from './clipping/clipping-webhook.controller';
import { ClippingReconcilerWorker } from './clipping/clipping-reconciler.worker';
import { VizardProvider } from './clipping/vizard.provider';
import { StorageJanitorWorker } from './janitor/storage-janitor.worker';
import { CLIPPING_PROVIDER } from './studio-cortes.types';

/**
 * Studio de Cortes (Sprint 1) — upload → Drive → corte (provedor) → copys (IA)
 * → fila de revisão (kanban). Publicação fica pro Sprint 2.
 */
@Module({
  imports: [SupabaseModule, LlmModule, AuthModule, ChannelDispatcherModule, AlertsModule],
  controllers: [StudioCortesController, CortesGoogleOAuthController, ClippingWebhookController],
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
  ],
  exports: [StudioCortesService],
})
export class StudioCortesModule {}
