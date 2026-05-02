import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AnthropicClient } from './anthropic.client';
import { DataCollectionService } from './data-collection.service';
import { TransferService } from './transfer.service';

@Module({
  imports: [KnowledgeModule],
  controllers: [AiController],
  providers: [AnthropicClient, AiService, DataCollectionService, TransferService],
  exports: [AiService, AnthropicClient, DataCollectionService, TransferService],
})
export class AiModule {}
