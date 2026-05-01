import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnthropicClient } from './anthropic.client';

@Module({
  imports: [KnowledgeModule],
  controllers: [AiController],
  providers: [AnthropicClient, AiService],
  exports: [AiService],
})
export class AiModule {}
