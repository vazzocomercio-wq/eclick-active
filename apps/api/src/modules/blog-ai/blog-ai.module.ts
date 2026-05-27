import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { SocialModule } from '../social/social.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { BlogAiController } from './blog-ai.controller';
import { BlogAiService } from './blog-ai.service';
import { BlogStudioService } from './blog-studio.service';
import { SanityBlogClient } from './sanity-blog.client';
import { BlogPublisherWorkerService } from './blog-publisher-worker.service';

/**
 * Blog IA — geração de conteúdo do blog (GEO) por IA, com fila de revisão
 * e publicação no Sanity. Reusa LlmService (texto) e ImageGenerationService
 * (capa, via SocialModule) + cliente Sanity de escrita. O Estúdio do Blog
 * (prompts editáveis + base de conhecimento) usa o UrlScraper (KnowledgeModule).
 */
@Module({
  imports: [SupabaseModule, LlmModule, AuthModule, SocialModule, KnowledgeModule],
  controllers: [BlogAiController],
  providers: [BlogAiService, BlogStudioService, SanityBlogClient, BlogPublisherWorkerService],
  exports: [BlogAiService],
})
export class BlogAiModule {}
