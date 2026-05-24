import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { EventsGateway } from '../../../gateways/events.gateway';
import { SocialContentsService } from '../social-contents.service';
import { SocialChannelCredentialsService } from './social-channel-credentials.service';
import { InstagramGraphProvider } from './providers/instagram-graph.provider';
import { TikTokBusinessProvider } from './providers/tiktok.provider';
import type {
  PublishingProvider,
  PublishInput,
  PublishResult,
  PublishingChannel,
  SocialPublishAttempt,
} from './publishing.types';
import type { SocialContent } from '../social.types';

export interface ChannelOutcome {
  channel: PublishingChannel;
  result: PublishResult;
}

export interface PublishContentResult {
  content_id: string;
  outcomes: ChannelOutcome[];
  any_success: boolean;
}

const CHANNEL_MAP: Record<string, PublishingChannel> = {
  instagram: 'instagram_business',
  instagram_business: 'instagram_business',
  tiktok: 'tiktok_business',
  tiktok_business: 'tiktok_business',
  facebook: 'facebook_page',
};

/**
 * Orquestrador de publicação. Despacha pra cada provider conforme os
 * canais agendados no conteúdo, registra cada tentativa e atualiza
 * status final.
 */
@Injectable()
export class SocialPublishingService {
  private readonly log = new Logger(SocialPublishingService.name);
  private readonly providers: Map<PublishingChannel, PublishingProvider>;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
    private readonly contents: SocialContentsService,
    private readonly creds: SocialChannelCredentialsService,
    instagram: InstagramGraphProvider,
    tiktok: TikTokBusinessProvider,
  ) {
    this.providers = new Map<PublishingChannel, PublishingProvider>([
      ['instagram_business', instagram],
      ['tiktok_business', tiktok],
    ]);
  }

  async publishContent(
    orgId: string,
    contentId: string,
  ): Promise<PublishContentResult> {
    const content = await this.contents.findById(orgId, contentId);
    if (content.status === 'published') {
      throw new BadRequestException('Conteúdo já publicado');
    }

    const channels = (content.scheduled_channels ?? content.channels)
      .map((c) => CHANNEL_MAP[c])
      .filter((c): c is PublishingChannel => !!c);

    if (channels.length === 0) {
      throw new BadRequestException('Nenhum canal válido configurado');
    }

    const input = this.buildPublishInput(content);
    const outcomes: ChannelOutcome[] = [];
    const externalIds: Record<string, string> = {
      ...((content.external_post_ids as Record<string, string> | null) ?? {}),
    };

    for (const channel of channels) {
      const provider = this.providers.get(channel);
      if (!provider) {
        outcomes.push({
          channel,
          result: {
            success: false,
            error_code: 'no_provider',
            error_message: `Provider não registrado pra canal ${channel}`,
            provider_response: {},
          },
        });
        continue;
      }

      const t0 = Date.now();
      const result = await provider.publish(orgId, input, content.brand_id);
      const elapsed = Date.now() - t0;

      // Registra attempt
      const cred = await this.creds.findActive(orgId, channel, content.brand_id);
      await this.supabase.adminClient.from('social_publish_attempts').insert({
        org_id: orgId,
        content_id: contentId,
        channel,
        credential_id: cred?.id ?? null,
        status: result.success ? 'success' : 'failed',
        external_post_id: result.external_post_id ?? null,
        external_post_url: result.external_post_url ?? null,
        provider_response: result.provider_response,
        error_message: result.error_message ?? null,
        error_code: result.error_code ?? null,
        attempted_at: new Date(t0).toISOString(),
        completed_at: new Date().toISOString(),
        duration_ms: elapsed,
      });

      if (result.success && result.external_post_id) {
        externalIds[channel] = result.external_post_id;
      }
      outcomes.push({ channel, result });
    }

    const anySuccess = outcomes.some((o) => o.result.success);
    const allSuccess = outcomes.every((o) => o.result.success);
    const lastError = outcomes
      .filter((o) => !o.result.success)
      .map((o) => `${o.channel}: ${o.result.error_message}`)
      .join(' | ');

    // Atualiza content
    await this.supabase.adminClient
      .from('social_contents')
      .update({
        status: anySuccess ? 'published' : 'failed',
        published_at: anySuccess ? new Date().toISOString() : null,
        external_post_ids: externalIds,
        publish_attempts_count: content.publish_attempts_count + 1,
        last_publish_error: allSuccess ? null : lastError.slice(0, 500),
      } as never)
      .eq('id', contentId)
      .eq('org_id', orgId);

    // Emite evento
    try {
      this.events.emitToOrg(
        orgId,
        anySuccess ? 'social:content-ready' : 'social:ready-to-publish',
        {
          content_id: contentId,
          content_type: content.content_type,
          title: content.title,
        },
      );
      // Evento dedicado pro editor aberto dar refresh em tempo real
      // (cobre tanto "Publicar agora" quanto o publisher agendado).
      const firstSuccess = outcomes.find((o) => o.result.success);
      this.events.emitToOrg(orgId, 'social:published', {
        content_id: contentId,
        status: anySuccess ? 'published' : 'failed',
        any_success: anySuccess,
        channels: outcomes.map((o) => o.channel),
        external_post_url: firstSuccess?.result.external_post_url ?? null,
      });
    } catch {
      /* best-effort */
    }

    return { content_id: contentId, outcomes, any_success: anySuccess };
  }

  async listAttempts(
    orgId: string,
    contentId: string,
  ): Promise<SocialPublishAttempt[]> {
    const { data, error } = await this.supabase.adminClient
      .from('social_publish_attempts')
      .select('*')
      .eq('org_id', orgId)
      .eq('content_id', contentId)
      .order('attempted_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SocialPublishAttempt[];
  }

  // ─── helpers ────────────────────────────────────

  private buildPublishInput(content: SocialContent): PublishInput {
    const captionParts: string[] = [];
    if (content.caption) captionParts.push(content.caption);
    if (content.hashtags.length > 0) {
      captionParts.push(
        '',
        content.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' '),
      );
    }
    if (content.cta) captionParts.push('', `→ ${content.cta}`);
    const caption = captionParts.join('\n');

    const isCarousel = content.content_type === 'carousel';
    let imageUrls: string[] = [];

    if (isCarousel && content.slides.length > 0) {
      imageUrls = content.slides
        .filter((s) => !!s.image_url)
        .map((s) => s.image_url as string);
    } else if (content.cover_image_url) {
      imageUrls = [content.cover_image_url];
    } else {
      imageUrls = content.media.map((m) => m.url).filter(Boolean);
    }

    return {
      caption,
      image_urls: imageUrls,
      is_carousel: isCarousel && imageUrls.length > 1,
      alt_text: content.media[0]?.alt_text,
    };
  }
}
