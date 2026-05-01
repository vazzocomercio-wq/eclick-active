import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnthropicClient } from './anthropic.client';

@Module({
  controllers: [AiController],
  providers: [AnthropicClient, AiService],
  exports: [AiService],
})
export class AiModule {}
