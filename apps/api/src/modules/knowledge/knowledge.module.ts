import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ProductsService } from './products.service';
import { EmbeddingsClient } from './embeddings.client';

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [KnowledgeService, ProductsService, EmbeddingsClient],
  exports: [KnowledgeService, EmbeddingsClient],
})
export class KnowledgeModule {}
