import { Module } from '@nestjs/common';
import { ZapiWebhookController } from './zapi/zapi-webhook.controller';
import { ZapiWebhookService } from './zapi/zapi-webhook.service';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [ContactsModule, ConversationsModule],
  controllers: [ZapiWebhookController],
  providers: [ZapiWebhookService],
})
export class WebhooksModule {}
