import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiTestController } from './ai-test.controller';
import { AiTestService } from './ai-test.service';

@Module({
  imports: [AiModule, KnowledgeModule],
  controllers: [AiTestController],
  providers: [AiTestService],
})
export class AiTestModule {}
