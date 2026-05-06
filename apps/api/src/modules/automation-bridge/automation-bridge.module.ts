import { Module } from '@nestjs/common';
import { AutomationBridgeController } from './automation-bridge.controller';
import { AutomationBridgeService } from './automation-bridge.service';
import { NotifyDigestWorker } from './notify-digest.worker';

/**
 * Onda 4 / A3 — SaaS↔Active Automation Bridge.
 *
 * Endpoints server-to-server chamados pelo motor StoreAutomationEngine
 * do SaaS pra disparar ações que dependem da infraestrutura WhatsApp/cart
 * do Active.
 *
 * Depende de @Global SupabaseModule + ChannelDispatcher (vem do
 * common/channels/channels.module @Global). Não importa AuthModule
 * porque os endpoints usam shared secret (não JWT).
 */
@Module({
  controllers: [AutomationBridgeController],
  providers: [AutomationBridgeService, NotifyDigestWorker],
  exports: [AutomationBridgeService],
})
export class AutomationBridgeModule {}
