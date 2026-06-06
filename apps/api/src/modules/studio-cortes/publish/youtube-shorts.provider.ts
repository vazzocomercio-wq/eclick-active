import { Injectable, Logger } from '@nestjs/common';
import { CortesDriveClient } from '../cortes-drive.client';
import { CortesYouTubeService } from './cortes-youtube.service';
import type { PublishResult } from '../../social/publishing/publishing.types';

export interface YouTubeShortInput {
  video_url: string;
  title: string;
  description: string;
  tags?: string[];
  privacy?: 'public' | 'private' | 'unlisted';
  /**
   * false = VÍDEO LONGO (não Short): usa categoria custom, NÃO força #Shorts e
   * a URL final é watch?v=. Default true (preserva o comportamento de Shorts
   * usado pelo Studio de Cortes).
   */
  is_short?: boolean;
  /** Categoria do YouTube (sobrescreve a default). Ex: '27' = Educação. */
  category_id?: string;
  /**
   * Miniatura (capa) — URL de imagem pública. Após o upload, sobe via
   * thumbnails.set (best-effort: se falhar, o vídeo já está no ar). Só vídeo
   * longo usa — Short pega frame do próprio vídeo.
   */
  thumbnail_url?: string;
}

const YT_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
const YT_THUMBNAIL_SET_URL =
  'https://www.googleapis.com/upload/youtube/v3/thumbnails/set?uploadType=media&videoId=';
// Categoria default (22 = People & Blogs; 28 = Ciência e Tecnologia). Override via env.
const DEFAULT_CATEGORY = process.env.CORTES_YT_CATEGORY ?? '22';
// Custo de cota do videos.insert (≈100 unidades desde 04/12/2025). Só pra log.
const YT_INSERT_QUOTA_COST = 100;
const DAILY_QUOTA = 10_000;

/**
 * Publica um corte vertical como YouTube Short via Data API v3 (videos.insert,
 * upload resumable). Não existe endpoint "Shorts": vídeo vertical ≤180s vira
 * Short automaticamente; #Shorts na descrição reforça.
 *
 * Auth: reusa o OAuth Google da conexão de cortes (CortesDriveClient), que no
 * Sprint 2 passa a pedir também o escopo youtube.upload. Mesma conta do Drive.
 */
@Injectable()
export class YouTubeShortsProvider {
  readonly channel = 'youtube' as const;
  private readonly log = new Logger(YouTubeShortsProvider.name);
  private quotaUsedToday = 0;

  constructor(
    private readonly drive: CortesDriveClient,
    private readonly youtube: CortesYouTubeService,
  ) {}

  async isAvailable(orgId: string, channelCredId?: string | null): Promise<boolean> {
    if (channelCredId) return true;
    const channels = await this.youtube.listChannels(orgId);
    if (channels.length > 0) return true;
    return this.drive.hasYouTubeScope(orgId); // fallback: canal padrão do Drive
  }

  /**
   * channelCredId = id do canal escolhido (cortes_youtube_channels). Se null,
   * cai no canal PADRÃO da conta Google do Drive (fallback legado) — que pode
   * não ser o canal certo; por isso a UI sugere conectar o canal específico.
   */
  async publish(
    orgId: string,
    input: YouTubeShortInput,
    channelCredId?: string | null,
  ): Promise<PublishResult> {
    let token: string;
    try {
      if (channelCredId) {
        token = await this.youtube.getValidAccessToken(orgId, channelCredId);
      } else {
        if (!(await this.drive.hasYouTubeScope(orgId))) {
          return {
            success: false,
            error_code: 'no_youtube_channel',
            error_message:
              'Conecte o canal do YouTube no painel do corte (aba YouTube → Conectar canal) pra escolher onde publicar.',
            provider_response: {},
          };
        }
        token = await this.drive.getAccessTokenForOrg(orgId);
      }
    } catch (err) {
      return {
        success: false,
        error_code: 'yt_auth',
        error_message: err instanceof Error ? err.message : String(err),
        provider_response: {},
      };
    }

    try {
      // 1. Baixa o vídeo do corte (URL do provedor de corte ou Drive).
      const videoRes = await fetch(input.video_url, { signal: AbortSignal.timeout(120_000) });
      if (!videoRes.ok) {
        return {
          success: false,
          error_code: 'download_failed',
          error_message: `Falha ao baixar o corte (HTTP ${videoRes.status})`,
          provider_response: {},
        };
      }
      const bytes = Buffer.from(await videoRes.arrayBuffer());

      const isShort = input.is_short !== false; // default true
      const metadata = {
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: (input.tags ?? []).slice(0, 15),
          categoryId: input.category_id ?? DEFAULT_CATEGORY,
        },
        status: {
          privacyStatus: input.privacy ?? 'public',
          selfDeclaredMadeForKids: false,
        },
      };

      // 2. Inicia upload resumable → pega a URL de upload no header Location.
      const initRes = await fetch(YT_UPLOAD_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': 'video/*',
          'X-Upload-Content-Length': String(bytes.length),
        },
        body: JSON.stringify(metadata),
        signal: AbortSignal.timeout(30_000),
      });
      if (!initRes.ok) {
        const t = await initRes.text().catch(() => '');
        return {
          success: false,
          error_code: 'yt_init_failed',
          error_message: `YouTube init falhou (HTTP ${initRes.status}): ${t.slice(0, 200)}`,
          provider_response: {},
        };
      }
      const uploadUrl = initRes.headers.get('location');
      if (!uploadUrl) {
        return {
          success: false,
          error_code: 'yt_no_upload_url',
          error_message: 'YouTube não retornou URL de upload (Location).',
          provider_response: {},
        };
      }

      // 3. Sobe os bytes do vídeo.
      const upRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'video/*', 'Content-Length': String(bytes.length) },
        body: bytes,
        signal: AbortSignal.timeout(180_000),
      });
      const upBody = (await upRes.json().catch(() => ({}))) as {
        id?: string;
        error?: { message?: string };
      };
      if (!upRes.ok || !upBody.id) {
        return {
          success: false,
          error_code: 'yt_upload_failed',
          error_message: `YouTube upload falhou (HTTP ${upRes.status}): ${
            upBody.error?.message ?? ''
          }`.slice(0, 300),
          provider_response: upBody as Record<string, unknown>,
        };
      }

      // Log de cota (videos.insert ~100 unidades). Alerta se aproximar do teto.
      this.quotaUsedToday += YT_INSERT_QUOTA_COST;
      this.log.log(
        `[youtube] vídeo ${upBody.id} publicado — cota usada ~${this.quotaUsedToday}/${DAILY_QUOTA} hoje`,
      );
      if (this.quotaUsedToday >= DAILY_QUOTA * 0.8) {
        this.log.warn(
          `[youtube] cota diária perto do teto (${this.quotaUsedToday}/${DAILY_QUOTA}) — uploads podem falhar até reset (meia-noite PT)`,
        );
      }

      // 4. Miniatura (só vídeo longo) — best-effort: o vídeo já está publicado.
      let thumbnailSet = false;
      if (!isShort && input.thumbnail_url) {
        thumbnailSet = await this.setThumbnail(token, upBody.id, input.thumbnail_url);
      }

      return {
        success: true,
        external_post_id: upBody.id,
        external_post_url: isShort
          ? `https://youtube.com/shorts/${upBody.id}`
          : `https://www.youtube.com/watch?v=${upBody.id}`,
        provider_response: { video_id: upBody.id, thumbnail_set: thumbnailSet },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.log.warn(`[youtube] publish falhou (org=${orgId}): ${msg}`);
      return {
        success: false,
        error_code: 'yt_error',
        error_message: msg.slice(0, 400),
        provider_response: {},
      };
    }
  }

  /**
   * Sobe a miniatura do vídeo (thumbnails.set, uploadType=media). Aceita o
   * escopo youtube.upload (já concedido na conexão do canal). Best-effort:
   * retorna false sem lançar — a capa pode ser ajustada depois no Studio.
   */
  private async setThumbnail(
    token: string,
    videoId: string,
    thumbnailUrl: string,
  ): Promise<boolean> {
    try {
      const imgRes = await fetch(thumbnailUrl, { signal: AbortSignal.timeout(30_000) });
      if (!imgRes.ok) {
        this.log.warn(`[youtube] miniatura: download falhou (HTTP ${imgRes.status})`);
        return false;
      }
      const contentType = imgRes.headers.get('content-type') ?? 'image/png';
      const imgBytes = Buffer.from(await imgRes.arrayBuffer());
      // YouTube exige ≤2MB. Se passar, pula (não derruba a publicação).
      if (imgBytes.length > 2 * 1024 * 1024) {
        this.log.warn(`[youtube] miniatura > 2MB (${imgBytes.length}) — pulando set`);
        return false;
      }
      const res = await fetch(`${YT_THUMBNAIL_SET_URL}${videoId}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': contentType,
          'Content-Length': String(imgBytes.length),
        },
        body: imgBytes,
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        this.log.warn(`[youtube] thumbnails.set falhou (HTTP ${res.status}): ${t.slice(0, 200)}`);
        return false;
      }
      this.log.log(`[youtube] miniatura aplicada ao vídeo ${videoId}`);
      return true;
    } catch (err) {
      this.log.warn(`[youtube] thumbnails.set erro: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }
}
