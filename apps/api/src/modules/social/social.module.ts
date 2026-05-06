import { Module } from '@nestjs/common';
import { SupabaseModule } from '../../common/supabase/supabase.module';
import { LlmModule } from '../../common/llm/llm.module';
import { AuthModule } from '../../common/auth/auth.module';
import { EventsModule } from '../../gateways/events.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { AiPersonaModule } from '../ai-persona/ai-persona.module';
import { SocialController } from './social.controller';
import { SocialBrandsService } from './social-brands.service';
import { SocialCalendarsService } from './social-calendars.service';
import { SocialContentsService } from './social-contents.service';
import { SocialAiGeneratorService } from './social-ai/social-ai-generator.service';
import { SocialExportService } from './social-export.service';
import { SocialSchedulerService } from './social-scheduler.service';
import { ImageGenerationService } from './image-generation/image-generation.service';
import { CanvaImageProvider } from './image-generation/providers/canva.provider';
import { OpenAIImageProvider } from './image-generation/providers/openai.provider';
import { PlaceholderImageProvider } from './image-generation/providers/placeholder.provider';
import { SocialChannelCredentialsService } from './publishing/social-channel-credentials.service';
import { SocialPublishingService } from './publishing/social-publishing.service';
import { SocialPublisherWorkerService } from './publishing/social-publisher-worker.service';
import { InstagramGraphProvider } from './publishing/providers/instagram-graph.provider';
import { TikTokBusinessProvider } from './publishing/providers/tiktok.provider';
import { InstagramInsightsService } from './analytics/instagram-insights.service';
import { SocialMetricsService } from './analytics/social-metrics.service';
import { SocialSignalsService } from './analytics/social-signals.service';
import { SocialMetricsWorkerService } from './analytics/social-metrics-worker.service';
import { SocialHashtagsService } from './analytics/social-hashtags.service';
import { SocialAdBoostService } from './boost/social-ad-boost.service';

@Module({
  imports: [
    SupabaseModule,
    LlmModule,
    AuthModule,
    EventsModule,
    KnowledgeModule,
    AiPersonaModule,
  ],
  controllers: [SocialController],
  providers: [
    SocialBrandsService,
    SocialCalendarsService,
    SocialContentsService,
    SocialAiGeneratorService,
    SocialExportService,
    SocialSchedulerService,
    ImageGenerationService,
    CanvaImageProvider,
    OpenAIImageProvider,
    PlaceholderImageProvider,
    SocialChannelCredentialsService,
    SocialPublishingService,
    SocialPublisherWorkerService,
    InstagramGraphProvider,
    TikTokBusinessProvider,
    InstagramInsightsService,
    SocialMetricsService,
    SocialSignalsService,
    SocialMetricsWorkerService,
    SocialHashtagsService,
    SocialAdBoostService,
  ],
  exports: [
    SocialBrandsService,
    SocialContentsService,
    SocialAiGeneratorService,
    SocialPublishingService,
    SocialChannelCredentialsService,
    SocialMetricsService,
    SocialSignalsService,
    SocialHashtagsService,
    SocialAdBoostService,
  ],
})
export class SocialModule {}
