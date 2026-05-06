import { Injectable, Logger } from '@nestjs/common';
import { SocialChannelCredentialsService } from '../social-channel-credentials.service';
import type {
  PublishingProvider,
  PublishInput,
  PublishResult,
  PublishingChannel,
} from '../publishing.types';

/**
 * Provider TikTok Business — STUB.
 *
 * TikTok Posts API ainda é restrita (whitelist required) e o flow de
 * publicação envolve upload de vídeo via chunked upload + create.
 * Implementação completa fica pra fase 2.1.
 *
 * Quando ativar:
 *   1. App TikTok For Business + Posts API habilitada
 *   2. social_channel_credentials.channel='tiktok_business'
 *   3. Substituir esse stub por fetch() em https://open.tiktokapis.com/v2/...
 */
@Injectable()
export class TikTokBusinessProvider implements PublishingProvider {
  private readonly log = new Logger(TikTokBusinessProvider.name);
  readonly channel: PublishingChannel = 'tiktok_business';

  constructor(private readonly creds: SocialChannelCredentialsService) {}

  async isAvailable(orgId: string, brandId?: string | null): Promise<boolean> {
    const cred = await this.creds.findActive(orgId, this.channel, brandId);
    return !!cred && cred.is_active;
  }

  async publish(
    orgId: string,
    _input: PublishInput,
    _brandId?: string | null,
  ): Promise<PublishResult> {
    this.log.warn(
      `TikTok publish chamado pra org=${orgId} mas ainda não implementado`,
    );
    return {
      success: false,
      error_code: 'not_implemented',
      error_message: 'Provider TikTok Business ainda não implementado (MVP 2.1)',
      provider_response: {},
    };
  }
}
