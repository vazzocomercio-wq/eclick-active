import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { CanvaImageProvider } from './providers/canva.provider';
import { OpenAIImageProvider } from './providers/openai.provider';
import { PlaceholderImageProvider } from './providers/placeholder.provider';
import type {
  GenerateImageInput,
  ImageProvider,
} from './image-generation.types';

interface UploadResult {
  url: string;
  storage_path: string;
  provider: 'canva' | 'openai' | 'placeholder';
  width: number;
  height: number;
  mime_type: string;
}

const SIGNED_URL_TTL = 60 * 60 * 24 * 30; // 30 dias

// Renova quando faltar menos que isso pro vencimento (worker diário + publish)
export const SIGNED_URL_REFRESH_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

const BUCKET = 'social-media';

/**
 * Orquestrador de geração de imagens. Tenta na ordem:
 *   1. CanvaProvider (se org tem brand kit + OAuth Canva)
 *   2. OpenAIProvider (se OPENAI_API_KEY configurada)
 *   3. PlaceholderProvider (sempre disponível, SVG)
 *
 * Quem não estiver `isAvailable()` é pulado. O primeiro que conseguir
 * gerar com sucesso "vence". Em caso de erro num provider, cai no
 * próximo automaticamente — usuário sempre recebe alguma imagem.
 *
 * Persiste no bucket `social-media` do Storage e retorna signed URL.
 */
@Injectable()
export class ImageGenerationService {
  private readonly log = new Logger(ImageGenerationService.name);
  private readonly providers: ImageProvider[];

  constructor(
    private readonly supabase: SupabaseService,
    canva: CanvaImageProvider,
    openai: OpenAIImageProvider,
    placeholder: PlaceholderImageProvider,
  ) {
    this.providers = [canva, openai, placeholder];
  }

  /**
   * Gera + faz upload no bucket social-media.
   * Retorna URL pública (signed URL com TTL longo).
   */
  async generateAndUpload(
    orgId: string,
    input: GenerateImageInput,
    folder: string,
  ): Promise<UploadResult> {
    let lastError: unknown = null;
    for (const provider of this.providers) {
      try {
        if (!(await provider.isAvailable(orgId))) continue;
        const img = await provider.generate(orgId, input);
        const url = await this.upload(orgId, folder, img);
        return {
          url: url.signedUrl,
          storage_path: url.storage_path,
          provider: img.provider,
          width: img.width,
          height: img.height,
          mime_type: img.mimeType,
        };
      } catch (err) {
        lastError = err;
        this.log.warn(
          `provider ${provider.name} falhou (org=${orgId}): ${String(err)}`,
        );
        continue;
      }
    }
    throw new Error(
      `Todos os providers falharam: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  private async upload(
    orgId: string,
    folder: string,
    img: { buffer: Buffer; mimeType: string; ext: string },
  ): Promise<{ signedUrl: string; storage_path: string }> {
    const filename = `${randomUUID()}.${img.ext}`;
    const storagePath = `${orgId}/${folder}/${filename}`;
    const { error: upErr } = await this.supabase.adminClient.storage
      .from(BUCKET)
      .upload(storagePath, img.buffer, {
        contentType: img.mimeType,
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data: signed, error: signErr } = await this.supabase.adminClient.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, SIGNED_URL_TTL);
    if (signErr || !signed) {
      throw signErr ?? new Error('createSignedUrl falhou');
    }
    return { signedUrl: signed.signedUrl, storage_path: storagePath };
  }

  // ─── Renovação de signed URLs ─────────────────────
  //
  // Signed URLs vencem (TTL acima). O caminho do arquivo fica embutido na
  // própria URL (`/object/sign/social-media/<path>?token=...`), então dá pra
  // renovar QUALQUER URL antiga do bucket — inclusive rows legadas que nunca
  // persistiram storage_path — mesmo depois de vencida.

  /** Extrai o storage_path de uma signed URL do bucket social-media (ou null). */
  pathFromUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const m = url.match(/\/object\/sign\/social-media\/([^?]+)/);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch {
      return m[1];
    }
  }

  /** Vencimento (ms epoch) do token da signed URL, ou null se ilegível. */
  urlExpiresAt(url: string | null | undefined): number | null {
    if (!url) return null;
    const token = new RegExp('[?&]token=([^&]+)').exec(url)?.[1];
    if (!token) return null;
    try {
      const payload = token.split('.')[1];
      const decoded = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as { exp?: number };
      return typeof decoded.exp === 'number' ? decoded.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  /**
   * Renova a URL se for do bucket social-media e estiver a menos de
   * `thresholdMs` do vencimento (ou já vencida/ilegível).
   * Retorna a URL nova, ou null se não precisa/não dá pra renovar.
   */
  async refreshUrlIfExpiring(
    url: string | null | undefined,
    thresholdMs: number = SIGNED_URL_REFRESH_THRESHOLD_MS,
    persistedPath?: string | null,
  ): Promise<string | null> {
    const path = persistedPath ?? this.pathFromUrl(url);
    if (!path) return null;
    const exp = this.urlExpiresAt(url);
    if (exp !== null && exp - Date.now() > thresholdMs) return null;

    const { data: signed, error } = await this.supabase.adminClient.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (error || !signed) {
      this.log.warn(`refresh de signed URL falhou (${path}): ${String(error)}`);
      return null;
    }
    return signed.signedUrl;
  }
}
