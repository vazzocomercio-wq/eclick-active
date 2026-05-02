import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SupabaseModule } from './common/supabase/supabase.module';
import { AuthModule } from './common/auth/auth.module';
import { ChannelsModule as ChannelDispatcherModule } from './common/channels/channels.module';
import { EventsModule } from './gateways/events.module';
import { AiModule } from './modules/ai/ai.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { ChannelsModule } from './modules/channels/channels.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { CopilotModule } from './modules/copilot/copilot.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DealsModule } from './modules/deals/deals.module';
import { InternalModule } from './modules/internal/internal.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { MessagesModule } from './modules/messages/messages.module';
import { PipelinesModule } from './modules/pipelines/pipelines.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SettingsModule } from './modules/settings/settings.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TeamModule } from './modules/team/team.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';

@Module({
  imports: [
    // @Global infra
    SupabaseModule,
    AuthModule,
    ChannelDispatcherModule,
    EventsModule,
    // Feature modules
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    PipelinesModule,
    DealsModule,
    DashboardModule,
    TasksModule,
    KnowledgeModule,
    AiModule,
    CopilotModule,
    ChannelsModule,
    SettingsModule,
    TeamModule,
    ReportsModule,
    AutomationsModule,
    WebhooksModule,
    InternalModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
