import { Global, Module } from '@nestjs/common';
import { ZapiWebhookController } from './zapi/zapi-webhook.controller';
import { ZapiWebhookService } from './zapi/zapi-webhook.service';
import { InstagramWebhookController } from './instagram/instagram-webhook.controller';
import { InstagramWebhookService } from './instagram/instagram-webhook.service';
import { InstagramOAuthController } from './instagram/instagram-oauth.controller';
import { EmailWebhookService } from './email/email-webhook.service';
import { EmailPollerService } from './email/email-poller.service';
import { EmailConnectController } from './email/email-connect.controller';
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
  controllers: [
    ZapiWebhookController,
    OutboundWebhookController,
    InstagramWebhookController,
    InstagramOAuthController,
    EmailConnectController,
  ],
  providers: [
    ZapiWebhookService,
    AutoLeadService,
    OutboundWebhookService,
    InstagramWebhookService,
    EmailWebhookService,
    EmailPollerService,
  ],
  exports: [AutoLeadService, OutboundWebhookService],
})
export class WebhooksModule {}
