import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { CalendarIntegrationsModule } from '../calendar-integrations/calendar-integrations.module';
import { SacModule } from '../sac/sac.module';
import { BridgeModule } from '../bridge/bridge.module';
import { SocialModule } from '../social/social.module';
import { WhatsAppCommerceModule } from '../whatsapp-commerce/whatsapp-commerce.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';
import { CopilotHelpController } from './copilot-help.controller';
import { CopilotHelpService } from './copilot-help.service';

@Module({
  imports: [
    AuthModule,
    KnowledgeModule,
    AppointmentsModule,
    CalendarIntegrationsModule,
    SacModule,
    BridgeModule,
    SocialModule,
    WhatsAppCommerceModule,
  ],
  controllers: [CopilotController, CopilotHelpController],
  providers: [CopilotService, CopilotHelpService],
})
export class CopilotModule {}
