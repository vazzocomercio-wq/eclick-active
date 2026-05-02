import { Global, Module } from '@nestjs/common';
import { ZapiWebhookController } from './zapi/zapi-webhook.controller';
import { ZapiWebhookService } from './zapi/zapi-webhook.service';
import { AutoLeadService } from './auto-lead.service';
import { OutboundWebhookController } from './outbound/outbound-webhook.controller';
import { OutboundWebhookService } from './outbound/outbound-webhook.service';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AiModule } from '../ai/ai.module';
import { AutomationsModule } from '../automations/automations.module';

/**
 * Marcado @Global pra que `OutboundWebhookService` seja injetável em
 * qualquer module sem precisar importar `WebhooksModule` em cada um
 * (deals, contacts, tasks, etc. dependem dele pra fire-and-forget).
 */
@Global()
@Module({
  imports: [ContactsModule, ConversationsModule, AiModule, AutomationsModule],
  controllers: [ZapiWebhookController, OutboundWebhookController],
  providers: [ZapiWebhookService, AutoLeadService, OutboundWebhookService],
  exports: [AutoLeadService, OutboundWebhookService],
})
export class WebhooksModule {}
