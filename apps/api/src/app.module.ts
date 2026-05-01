import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { ChannelsModule } from './common/channels/channels.module';
import { EventsModule } from './gateways/events.module';
import { AiModule } from './modules/ai/ai.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DealsModule } from './modules/deals/deals.module';
import { MessagesModule } from './modules/messages/messages.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { TasksModule } from './modules/tasks/tasks.module';
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
    PipelinesModule,
    DealsModule,
    DashboardModule,
    TasksModule,
    AiModule,
    WebhooksModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
