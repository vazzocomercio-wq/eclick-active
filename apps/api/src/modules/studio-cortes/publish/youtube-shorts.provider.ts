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
}

const YT_UPLOAD_URL =
  'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status';
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

      const metadata = {
        snippet: {
          title: input.title.slice(0, 100),
          description: input.description.slice(0, 5000),
          tags: (input.tags ?? []).slice(0, 15),
          categoryId: DEFAULT_CATEGORY,
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

      return {
        success: true,
        external_post_id: upBody.id,
        external_post_url: `https://youtube.com/shorts/${upBody.id}`,
        provider_response: { video_id: upBody.id },
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
}
