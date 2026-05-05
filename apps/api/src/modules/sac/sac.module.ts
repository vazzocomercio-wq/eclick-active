import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EventsModule } from '../../gateways/events.module';
import { BridgeModule } from '../bridge/bridge.module';
import { SacController } from './sac.controller';
import { SacTicketsService } from './sac-tickets.service';
import { SacAiService } from './sac-ai.service';
import { SacSlaService } from './sac-sla.service';
import { SacTemplatesService } from './sac-templates.service';
import { SacPreventiveService } from './sac-preventive.service';
import { SacSchedulerService } from './sac-scheduler.service';

@Module({
  imports: [
    SupabaseModule,
    LlmModule,
    AuthModule,
    EventsModule,
    BridgeModule,
  ],
  controllers: [SacController],
  providers: [
    SacTicketsService,
    SacAiService,
    SacSlaService,
    SacTemplatesService,
    SacPreventiveService,
    SacSchedulerService,
  ],
  exports: [SacTicketsService, SacAiService, SacSlaService, SacPreventiveService],
})
export class SacModule {}
