import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SlackNotifierService } from './slack-notifier.service';
import { SlackController } from './slack.controller';

@Module({
  imports: [SupabaseModule],
  controllers: [SlackController],
  providers: [SlackNotifierService],
  exports: [SlackNotifierService],
})
export class SlackModule {}
