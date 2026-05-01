import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { CopilotController } from './copilot.controller';
import { CopilotService } from './copilot.service';

@Module({
  imports: [AuthModule],
  controllers: [CopilotController],
  providers: [CopilotService],
})
export class CopilotModule {}
