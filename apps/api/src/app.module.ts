import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { SupabaseModule } from './common/supabase/supabase.module';
import { ContactsModule } from './modules/contacts/contacts.module';

@Module({
  imports: [SupabaseModule, ContactsModule],
  controllers: [AppController],
})
export class AppModule {}
