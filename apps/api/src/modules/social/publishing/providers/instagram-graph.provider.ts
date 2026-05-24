import { Injectable, Logger } from '@nestjs/common';
import { SocialChannelCredentialsService } from '../social-channel-credentials.service';
import type {
  PublishingProvider,
  PublishInput,
  PublishResult,
  PublishingChannel,
} from '../publishing.types';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

interface ContainerResponse {
  id: string;
}

interface ErrorResponse {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    fbtrace_id?: string;
  };
}

/**
 * Provider real do Instagram Graph API (Business/Creator account).
 *
 * Pré-requisitos:
 *   - Meta App com permissões instagram_basic + instagram_content_publish
 *   - Long-lived Access Token (60 dias) salvo em
 *     social_channel_credentials.access_token_ciphertext
 *   - external_account_id = Instagram Business User ID (não o user pessoal)
 *
 * Fluxo de publicação:
 *   POST estático (1 imagem):
 *     1. POST /{ig_id}/media com image_url + caption → creation_id
 *     2. POST /{ig_id}/media_publish com creation_id → ig_post_id
 *
 *   CARROSSEL (N imagens):
 *     1. POST /{ig_id}/media com image_url + is_carousel_item=true (pra cada slide) → child_ids[]
 *     2. POST /{ig_id}/media com media_type=CAROUSEL + children=child_ids → carousel_creation_id
 *     3. POST /{ig_id}/media_publish com carousel_creation_id → ig_post_id
 *
 * Limitações conhecidas:
 *   - Caption max 2200 chars (truncamos se passar)
 *   - Carrossel max 10 slides
 *   - URLs precisam ser públicas e estáveis (signed URLs do Supabase
 *     funcionam — TTL 7d configurado em ImageGenerationService)
 *   - Não suporta hashtags em comments separados (vão na caption)
 */
@Injectable()
export class InstagramGraphProvider implements PublishingProvider {
  private readonly log = new Logger(InstagramGraphProvider.name);
  readonly channel: PublishingChannel = 'instagram_business';

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
    const decrypted = await this.creds.getDecryptedToken(
      orgId,
      this.channel,
      brandId,
    );
    if (!decrypted) {
      return {
        success: false,
        error_code: 'no_credential',
        error_message: 'Sem credencial Instagram ativa',
        provider_response: {},
      };
    }

    const { cred, access_token } = decrypted;
    const igUserId = cred.external_account_id;
    const caption = input.caption.slice(0, 2200);

    try {
      let creationId: string;
      let isVideo = false;

      if (input.video_url) {
        // REEL / vídeo: container media_type=REELS + video_url. share_to_feed
        // pra aparecer também no feed (não só na aba Reels).
        isVideo = true;
        const container = await this.createMediaContainer(igUserId, access_token, {
          media_type: 'REELS',
          video_url: input.video_url,
          caption,
          share_to_feed: 'true',
        });
        creationId = container.id;
      } else if (input.is_carousel && input.image_urls.length > 1) {
        const slides = input.image_urls.slice(0, 10);
        const childIds: string[] = [];
        for (const url of slides) {
          const child = await this.createMediaContainer(
            igUserId,
            access_token,
            { image_url: url, is_carousel_item: true },
          );
          childIds.push(child.id);
        }
        const carousel = await this.createMediaContainer(
          igUserId,
          access_token,
          {
            media_type: 'CAROUSEL',
            children: childIds.join(','),
            caption,
          },
        );
        creationId = carousel.id;
      } else {
        // Post simples
        if (input.image_urls.length === 0) {
          return {
            success: false,
            error_code: 'no_image',
            error_message: 'Post sem imagem',
            provider_response: {},
          };
        }
        const container = await this.createMediaContainer(
          igUserId,
          access_token,
          { image_url: input.image_urls[0], caption },
        );
        creationId = container.id;
      }

      // Instagram processa o container de forma ASSÍNCRONA
      // (IN_PROGRESS → FINISHED). Publicar antes do FINISHED retorna
      // "Media ID is not available" — causa real do bug intermitente (o retry
      // funcionava só porque o container já tinha terminado de processar).
      // Vídeo processa MUITO mais devagar que imagem → janela maior.
      await this.waitForContainerReady(creationId, access_token, isVideo);

      // Publica
      const publishRes = await this.fetchGraph(
        `/${igUserId}/media_publish`,
        access_token,
        { method: 'POST', body: { creation_id: creationId } },
      );

      const postId = (publishRes as { id?: string }).id;
      if (!postId) {
        return {
          success: false,
          error_code: 'publish_no_id',
          error_message: 'Resposta sem id de post',
          provider_response: publishRes as Record<string, unknown>,
        };
      }

      // Tenta puxar permalink
      let postUrl: string | undefined;
      try {
        const permalinkRes = await this.fetchGraph(
          `/${postId}?fields=permalink`,
          access_token,
          { method: 'GET' },
        );
        postUrl = (permalinkRes as { permalink?: string }).permalink;
      } catch {
        /* permalink é nice-to-have */
      }

      return {
        success: true,
        external_post_id: postId,
        external_post_url: postUrl,
        provider_response: { creation_id: creationId, post_id: postId },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`publish falhou (org=${orgId}): ${msg}`);
      await this.creds.markError(cred.id, msg).catch(() => {});
      return {
        success: false,
        error_code: 'graph_error',
        error_message: msg.slice(0, 500),
        provider_response: {},
      };
    }
  }

  // ─── helpers ────────────────────────────────────

  /**
   * Espera o container de mídia sair de IN_PROGRESS pra FINISHED antes de
   * publicar. Sem isso o media_publish dispara cedo demais e o Graph responde
   * "Media ID is not available". Poll curto (happy path ~1-3s); teto ~25s.
   * Cobre post simples e o container-pai do carrossel.
   */
  private async waitForContainerReady(
    creationId: string,
    token: string,
    isVideo = false,
  ): Promise<void> {
    // Imagem finaliza em segundos; vídeo (REELS) pode levar 1-3min processando.
    const maxAttempts = isVideo ? 40 : 10;
    const intervalMs = isVideo ? 5000 : 2500;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, i === 0 ? 1000 : intervalMs));
      let statusCode: string | undefined;
      try {
        const res = await this.fetchGraph(
          `/${creationId}?fields=status_code`,
          token,
          { method: 'GET' },
        );
        statusCode = (res as { status_code?: string }).status_code;
      } catch (err) {
        // erro transitório no GET de status — tenta de novo na próxima volta
        this.log.warn(
          `status_code check falhou (tentativa ${i + 1}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        continue;
      }
      if (statusCode === 'FINISHED') return;
      if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
        throw new Error(
          `Instagram não processou a imagem (status=${statusCode}). ` +
            'Confira se é JPG/PNG, https e com proporção entre 4:5 e 1.91:1.',
        );
      }
      // IN_PROGRESS → continua aguardando
    }
    throw new Error(
      'Tempo esgotado aguardando o Instagram processar a imagem (container IN_PROGRESS). Tente publicar de novo.',
    );
  }

  private async createMediaContainer(
    igUserId: string,
    token: string,
    body: Record<string, unknown>,
  ): Promise<ContainerResponse> {
    const res = await this.fetchGraph(`/${igUserId}/media`, token, {
      method: 'POST',
      body,
    });
    if (!res || typeof res !== 'object' || !('id' in res)) {
      throw new Error('Resposta sem id de container');
    }
    return res as ContainerResponse;
  }

  private async fetchGraph(
    path: string,
    token: string,
    opts: { method: 'GET' | 'POST'; body?: Record<string, unknown> },
  ): Promise<unknown> {
    const url = new URL(`${GRAPH_BASE}${path}`);
    url.searchParams.set('access_token', token);

    const init: RequestInit = {
      method: opts.method,
    };
    if (opts.body && opts.method === 'POST') {
      // Graph aceita query string ou form-urlencoded; form-urlencoded é mais robusto
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.body)) {
        form.append(k, String(v));
      }
      init.body = form;
      init.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    }

    const res = await fetch(url.toString(), init);
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
    if (!res.ok) {
      const errBody = parsed as ErrorResponse;
      const errMsg =
        errBody?.error?.message ?? `HTTP ${res.status}: ${text.slice(0, 200)}`;
      throw new Error(errMsg);
    }
    return parsed;
  }
}
