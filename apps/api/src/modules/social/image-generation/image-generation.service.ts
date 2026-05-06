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

const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 dias

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
      .from('social-media')
      .upload(storagePath, img.buffer, {
        contentType: img.mimeType,
        upsert: false,
      });
    if (upErr) throw upErr;

    const { data: signed, error: signErr } = await this.supabase.adminClient.storage
      .from('social-media')
      .createSignedUrl(storagePath, SIGNED_URL_TTL);
    if (signErr || !signed) {
      throw signErr ?? new Error('createSignedUrl falhou');
    }
    return { signedUrl: signed.signedUrl, storage_path: storagePath };
  }
}
