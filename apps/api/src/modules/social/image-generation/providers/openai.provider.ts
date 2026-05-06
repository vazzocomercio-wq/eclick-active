import { Injectable, Logger } from '@nestjs/common';
import type {
  GeneratedImage,
  GenerateImageInput,
  ImageProvider,
} from '../image-generation.types';

/**
 * Provider OpenAI Images — DALL·E 3 / gpt-image-1.
 * Disponível quando `OPENAI_API_KEY` está configurada.
 *
 * MVP 1: implementação stub que retorna unavailable. Quando a feature
 * for habilitada, basta:
 *   1. Setar `process.env.OPENAI_API_KEY`
 *   2. Adicionar fetch() pra https://api.openai.com/v1/images/generations
 *   3. Retornar buffer da resposta
 *
 * Stub permite que o ImageGenerationService já tente esse provider
 * sem quebrar (cai no PlaceholderProvider quando isAvailable=false).
 */
@Injectable()
export class OpenAIImageProvider implements ImageProvider {
  private readonly log = new Logger(OpenAIImageProvider.name);
  readonly name = 'openai' as const;

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.OPENAI_API_KEY);
  }

  async generate(orgId: string, input: GenerateImageInput): Promise<GeneratedImage> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY não configurada');
    }

    const width = input.width ?? 1024;
    const height = input.height ?? 1024;
    const size = `${width}x${height}`;

    // Reforça cores da marca no prompt
    const enrichedPrompt = `${input.prompt}\n\nEstilo: cores principais ${input.primaryColor} e ${input.secondaryColor}, design profissional para Instagram, alta qualidade, sem texto na imagem.`;

    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'dall-e-3',
          prompt: enrichedPrompt.slice(0, 4000),
          n: 1,
          size,
          response_format: 'b64_json',
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI image gen falhou: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = body.data?.[0]?.b64_json;
      if (!b64) throw new Error('Resposta sem b64_json');
      const buffer = Buffer.from(b64, 'base64');
      return {
        buffer,
        mimeType: 'image/png',
        provider: 'openai',
        width,
        height,
        ext: 'png',
      };
    } catch (err) {
      this.log.warn(`OpenAI image gen falhou (org=${orgId}): ${String(err)}`);
      throw err;
    }
  }
}
