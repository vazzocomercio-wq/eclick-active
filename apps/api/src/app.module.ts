import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SupabaseModule } from './common/supabase/supabase.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { MessagesModule } from './modules/messages/messages.module';

@Module({
  imports: [SupabaseModule, ContactsModule, ConversationsModule, MessagesModule],
  controllers: [AppController],
})
export class AppModule {}
