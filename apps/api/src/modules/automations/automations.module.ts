import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { AiModule } from '../ai/ai.module';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

@Module({
  // ChannelDispatcherService já vem do @Global() ChannelsModule em common/channels
  imports: [AuthModule, AiModule],
  controllers: [AutomationsController],
  providers: [AutomationsService],
  exports: [AutomationsService],
})
export class AutomationsModule {}
