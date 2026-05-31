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
 * Publica VÍDEO (reel) via FILE_UPLOAD: baixa o mp4 da nossa URL pública e
 * ENVIA os bytes direto pro TikTok (1 chunk). Não usa PULL_FROM_URL — assim
 * não precisa verificar o domínio do vídeo (os reels saem do bucket Supabase).
 * Fluxo assíncrono: init → upload (PUT) → poll do status até PUBLISH_COMPLETE.
 *
 * ⚠️ Pré-requisitos (setup externo do cliente):
 *   1. App no TikTok for Developers com Content Posting API + Login Kit,
 *      scopes video.publish + video.upload, e Direct Post habilitado.
 *   2. Token de acesso do usuário salvo em social_channel_credentials
 *      (channel='tiktok_business').
 *   3. Enquanto o app não passa pela auditoria do TikTok, só dá pra postar
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
    credId?: string | null,
  ): Promise<PublishResult> {
    const tok = credId
      ? await this.creds.getDecryptedTokenByCredId(orgId, credId)
      : await this.creds.getDecryptedToken(orgId, this.channel, brandId);
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
      // 1) baixa o mp4 da nossa URL pública pra enviar DIRETO (FILE_UPLOAD).
      //    Evita o PULL_FROM_URL, que exigiria verificar o domínio do vídeo
      //    (nossos reels saem do bucket Supabase, não verificável).
      let videoBytes: Buffer;
      try {
        const vidRes = await fetch(input.video_url, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!vidRes.ok) throw new Error(`HTTP ${vidRes.status}`);
        videoBytes = Buffer.from(await vidRes.arrayBuffer());
      } catch (e) {
        return {
          success: false,
          error_code: 'video_download_failed',
          error_message: `Não consegui baixar o vídeo pra enviar ao TikTok: ${
            e instanceof Error ? e.message : String(e)
          }`,
          provider_response: {},
        };
      }
      const videoSize = videoBytes.byteLength;

      // 2) init FILE_UPLOAD — reel curto cabe em 1 chunk (limite 64MB/chunk).
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
            source: 'FILE_UPLOAD',
            video_size: videoSize,
            chunk_size: videoSize,
            total_chunk_count: 1,
          },
        }),
        signal: AbortSignal.timeout(30_000),
      });
      const initJson = (await initRes.json()) as {
        data?: { publish_id?: string; upload_url?: string };
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
      const uploadUrl = initJson.data?.upload_url;
      if (!publishId || !uploadUrl) {
        return {
          success: false,
          error_code: 'no_publish_id',
          error_message: 'TikTok não retornou publish_id/upload_url.',
          provider_response: initJson as Record<string, unknown>,
        };
      }

      // 3) envia os bytes do vídeo pro upload_url (PUT, 1 chunk único).
      try {
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': 'video/mp4',
            'Content-Range': `bytes 0-${videoSize - 1}/${videoSize}`,
          },
          body: videoBytes,
          signal: AbortSignal.timeout(120_000),
        });
        if (!putRes.ok) {
          const t = await putRes.text().catch(() => '');
          return {
            success: false,
            error_code: 'tiktok_upload_failed',
            error_message: `Upload do vídeo falhou (HTTP ${putRes.status}) ${t.slice(0, 200)}`,
            provider_response: { status: putRes.status },
          };
        }
      } catch (e) {
        return {
          success: false,
          error_code: 'tiktok_upload_exception',
          error_message: e instanceof Error ? e.message : String(e),
          provider_response: {},
        };
      }

      // 4) poll do status (processamento assíncrono; teto ~60s)
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
