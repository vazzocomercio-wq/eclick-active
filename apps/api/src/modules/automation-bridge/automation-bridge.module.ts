import { Module } from '@nestjs/common';
import { AutomationBridgeController } from './automation-bridge.controller';
import { AutomationBridgeService } from './automation-bridge.service';
import { NotifyDigestWorker } from './notify-digest.worker';
import { DealsModule } from '../deals/deals.module';
import { TasksModule } from '../tasks/tasks.module';
import { ContactsModule } from '../contacts/contacts.module';

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
 *
 * M4 (2026-05-08): importa DealsModule + TasksModule pra create-campaign-card
 * (SaaS Campaign Center cria card no kanban + task vinculada).
 */
@Module({
  imports: [DealsModule, TasksModule, ContactsModule],
  controllers: [AutomationBridgeController],
  providers: [AutomationBridgeService, NotifyDigestWorker],
  exports: [AutomationBridgeService],
})
export class AutomationBridgeModule {}
