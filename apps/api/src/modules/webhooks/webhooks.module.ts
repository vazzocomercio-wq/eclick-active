import { Module } from '@nestjs/common';
import { ZapiWebhookController } from './zapi/zapi-webhook.controller';
import { ZapiWebhookService } from './zapi/zapi-webhook.service';
import { ContactsModule } from '../contacts/contacts.module';
import { ConversationsModule } from '../conversations/conversations.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [ContactsModule, ConversationsModule, AiModule],
  controllers: [ZapiWebhookController],
  providers: [ZapiWebhookService],
})
export class WebhooksModule {}
