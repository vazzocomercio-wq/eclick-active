import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AiPersonaModule } from '../ai-persona/ai-persona.module';
import { ReEngagementController } from './re-engagement.controller';
import { ReEngagementService } from './re-engagement.service';
import { ReEngagementWorker } from './re-engagement.worker';

@Module({
  imports: [AuthModule, AiPersonaModule],
  controllers: [ReEngagementController],
  providers: [ReEngagementService, ReEngagementWorker],
  exports: [ReEngagementService],
})
export class ReEngagementModule {}
