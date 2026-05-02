import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { KnowledgeController } from './knowledge.controller';
import { KnowledgeService } from './knowledge.service';
import { ProductsService } from './products.service';
import { EmbeddingsClient } from './embeddings.client';
import { UrlScraperService } from './url-scraper.service';
import { FileExtractorService } from './file-extractor.service';
import { LiveSourcesService } from './live-sources.service';

@Module({
  imports: [AuthModule],
  controllers: [KnowledgeController],
  providers: [
    KnowledgeService,
    ProductsService,
    EmbeddingsClient,
    UrlScraperService,
    FileExtractorService,
    LiveSourcesService,
  ],
  exports: [KnowledgeService, EmbeddingsClient, LiveSourcesService],
})
export class KnowledgeModule {}
