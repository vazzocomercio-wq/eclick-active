import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { ChannelsModule } from './common/channels/channels.module';
import { EventsModule } from './gateways/events.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    // @Global infra
    SupabaseModule,
    AuthModule,
    ChannelsModule,
    EventsModule,
    // Feature modules
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    WebhooksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
