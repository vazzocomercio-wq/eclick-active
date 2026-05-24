import { Injectable, Logger } from '@nestjs/common';
import { SocialChannelCredentialsService } from '../social-channel-credentials.service';
import type {
  PublishingProvider,
  PublishInput,
  PublishResult,
  PublishingChannel,
} from '../publishing.types';

/**
 * Provider TikTok Business — Content Posting API (Direct Post).
 *
 * Publica VÍDEO (reel) via PULL_FROM_URL: o TikTok baixa o mp4 da nossa URL
 * pública (bucket storefront-assets) e posta. Fluxo assíncrono: init → recebe
 * publish_id → poll do status até PUBLISH_COMPLETE.
 *
 * ⚠️ Pré-requisitos (setup externo do cliente):
 *   1. App no TikTok for Developers com Content Posting API + Login Kit,
 *      scopes video.publish + video.upload, e Direct Post habilitado.
 *   2. Domínio da URL do vídeo VERIFICADO no portal (URL ownership) — exigido
 *      pelo PULL_FROM_URL.
 *   3. Token de acesso do usuário salvo em social_channel_credentials
 *      (channel='tiktok_business').
 *   4. Enquanto o app não passa pela auditoria do TikTok, só dá pra postar
 *      como privado → privacy_level default = SELF_ONLY. Depois de auditado,
 *      setar metadata.privacy_level = 'PUBLIC_TO_EVERYONE'.
 *
 * Doc: https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
 */

const TIKTOK_API = 'https://open.tiktokapis.com/v2';

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
    input: PublishInput,
    brandId?: string | null,
  ): Promise<PublishResult> {
    const tok = await this.creds.getDecryptedToken(orgId, this.channel, brandId);
    if (!tok) {
      return {
        success: false,
        error_code: 'no_credential',
        error_message: 'Sem credencial ativa do TikTok pra esta org/marca.',
        provider_response: {},
      };
    }
    if (!input.video_url) {
      return {
        success: false,
        error_code: 'no_video',
        error_message: 'TikTok publica vídeo — gere um reel antes.',
        provider_response: {},
      };
    }

    const privacy =
      (tok.cred.metadata?.privacy_level as string) || 'SELF_ONLY';
    const headers = {
      Authorization: `Bearer ${tok.access_token}`,
      'Content-Type': 'application/json; charset=UTF-8',
    };

    try {
      // 1) init — TikTok puxa o vídeo da URL pública
      const initRes = await fetch(`${TIKTOK_API}/post/publish/video/init/`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          post_info: {
            title: (input.caption ?? '').slice(0, 2200),
            privacy_level: privacy,
            disable_comment: false,
            disable_duet: false,
            disable_stitch: false,
          },
          source_info: {
            source: 'PULL_FROM_URL',
            video_url: input.video_url,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const initJson = (await initRes.json()) as {
        data?: { publish_id?: string };
        error?: { code?: string; message?: string };
      };
      if (initJson.error && initJson.error.code !== 'ok') {
        return {
          success: false,
          error_code: initJson.error.code ?? 'tiktok_init_failed',
          error_message: initJson.error.message ?? 'Falha no init do TikTok',
          provider_response: initJson as Record<string, unknown>,
        };
      }
      const publishId = initJson.data?.publish_id;
      if (!publishId) {
        return {
          success: false,
          error_code: 'no_publish_id',
          error_message: 'TikTok não retornou publish_id.',
          provider_response: initJson as Record<string, unknown>,
        };
      }

      // 2) poll do status (processamento assíncrono; teto ~60s)
      let finalPostId: string | undefined;
      let lastStatus = 'PROCESSING_UPLOAD';
      for (let i = 0; i < 12; i++) {
        await new Promise((r) => setTimeout(r, 5000));
        const stRes = await fetch(`${TIKTOK_API}/post/publish/status/fetch/`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ publish_id: publishId }),
          signal: AbortSignal.timeout(20_000),
        });
        const stJson = (await stRes.json()) as {
          data?: { status?: string; publicaly_available_post_id?: string[] };
          error?: { code?: string; message?: string };
        };
        lastStatus = stJson.data?.status ?? lastStatus;
        if (lastStatus === 'PUBLISH_COMPLETE') {
          finalPostId = stJson.data?.publicaly_available_post_id?.[0];
          break;
        }
        if (lastStatus === 'FAILED') {
          return {
            success: false,
            error_code: 'tiktok_publish_failed',
            error_message: stJson.error?.message ?? 'TikTok marcou como FAILED',
            provider_response: stJson as Record<string, unknown>,
          };
        }
      }

      // Sucesso (mesmo se ainda processando — o publish_id é a referência)
      const username = tok.cred.external_username;
      return {
        success: true,
        external_post_id: finalPostId ?? publishId,
        external_post_url:
          finalPostId && username
            ? `https://www.tiktok.com/@${username}/video/${finalPostId}`
            : undefined,
        provider_response: { publish_id: publishId, status: lastStatus },
      };
    } catch (err) {
      return {
        success: false,
        error_code: 'tiktok_exception',
        error_message: err instanceof Error ? err.message : String(err),
        provider_response: {},
      };
    }
  }
}
