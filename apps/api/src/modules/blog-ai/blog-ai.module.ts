import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { SocialModule } from '../social/social.module';
import { BlogAiController } from './blog-ai.controller';
import { BlogAiService } from './blog-ai.service';
import { SanityBlogClient } from './sanity-blog.client';
import { BlogPublisherWorkerService } from './blog-publisher-worker.service';

/**
 * Blog IA — geração de conteúdo do blog (GEO) por IA, com fila de revisão
 * e publicação no Sanity. Reusa LlmService (texto) e ImageGenerationService
 * (capa, via SocialModule) + cliente Sanity de escrita.
 */
@Module({
  imports: [SupabaseModule, LlmModule, AuthModule, SocialModule],
  controllers: [BlogAiController],
  providers: [BlogAiService, SanityBlogClient, BlogPublisherWorkerService],
  exports: [BlogAiService],
})
export class BlogAiModule {}
