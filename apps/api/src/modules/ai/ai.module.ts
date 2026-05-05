import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AppointmentsModule } from '../appointments/appointments.module';
import { TagsModule } from '../tags/tags.module';
import { SacModule } from '../sac/sac.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiConciergeService } from './ai-concierge.service';
import { AnthropicClient } from './anthropic.client';
import { DataCollectionService } from './data-collection.service';
import { TransferService } from './transfer.service';

@Module({
  imports: [KnowledgeModule, AppointmentsModule, TagsModule, SacModule],
  controllers: [AiController],
  providers: [
    AnthropicClient,
    AiService,
    AiConciergeService,
    DataCollectionService,
    TransferService,
  ],
  exports: [
    AiService,
    AiConciergeService,
    AnthropicClient,
    DataCollectionService,
    TransferService,
  ],
})
export class AiModule {}
