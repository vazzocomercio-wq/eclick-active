import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AlertManagersService } from './alert-managers.service';
import { AlertManagersController } from './alert-managers.controller';
import { AlertRoutingService } from './alert-routing.service';
import { AlertRoutingController } from './alert-routing.controller';
import { AlertMessageFormatter } from './message-formatter';
import { AlertEngineService } from './alert-engine.service';
import { AlertEngineWorker } from './alert-engine.worker';
import { AlertDeliveriesController } from './alert-deliveries.controller';

/**
 * Módulo de Alertas — Bloco H do Active Intelligence.
 *
 * Componentes:
 *   - AlertManagersService — CRUD de gestores + verify-phone via WhatsApp
 *     (cold outbound, depende do fix do worker em baileys.session.ts)
 *   - AlertRoutingService — rules signal_type/severity → managers
 *   - AlertMessageFormatter — Camada 4 LLM com fallback template
 *   - AlertEngineService — pipeline signals→deliveries→dispatch
 *   - AlertEngineWorker — ticks immediate (5min) + slot (1h checa
 *     horários locais 8h/14h/18h + segunda 8h)
 *
 * Fecha o ciclo do Active Intelligence:
 *   ad_metrics_daily (C) → ad_signals (G) → alert_deliveries → WhatsApp
 *
 * Depende implicitamente de:
 *   - LlmModule (@Global) — Camada 4
 *   - SupabaseModule (@Global)
 *   - ChannelDispatcherModule — pra envio (peer module no app.module)
 */
@Module({
  imports: [AuthModule],
  controllers: [
    AlertManagersController,
    AlertRoutingController,
    AlertDeliveriesController,
  ],
  providers: [
    AlertManagersService,
    AlertRoutingService,
    AlertMessageFormatter,
    AlertEngineService,
    AlertEngineWorker,
  ],
  exports: [AlertManagersService, AlertEngineService],
})
export class AlertsModule {}
