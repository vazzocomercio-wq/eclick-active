import { Injectable, Logger } from '@nestjs/common';
import sharp from 'sharp';
import { LlmService } from '../../../../common/llm/llm.service';
import type {
  GeneratedImage,
  GenerateImageInput,
  ImageProvider,
} from '../image-generation.types';

/**
 * Provider OpenAI Images — gpt-image-1 (sucessor do dall-e-3, retirado em 2026).
 * Disponível quando `OPENAI_API_KEY` resolvível (BYOK ou platform).
 *
 * gpt-image-1 só aceita tamanhos fixos (1024x1024, 1024x1536, 1536x1024).
 * O blog (e outras features) podem pedir qualquer tamanho — então:
 *   1) Escolhemos o tamanho válido com aspect ratio mais próximo.
 *   2) Após gerar, recortamos com sharp pro width/height solicitado.
 *
 * Sem esse normalizador, qualquer pedido fora dos 3 tamanhos retorna 400 →
 * a chain cai no PlaceholderImageProvider (que escreve o prompt como texto
 * em SVG sobre gradiente — visual quebrado).
 */
@Injectable()
export class OpenAIImageProvider implements ImageProvider {
  private readonly log = new Logger(OpenAIImageProvider.name);
  readonly name = 'openai' as const;

  constructor(private readonly llm: LlmService) {}

  async isAvailable(orgId: string): Promise<boolean> {
    // BYOK: disponível se a org tem chave OpenAI resolvível (chat openai →
    // slot dedicado → env no modo platform). Org 'own' sem chave → false →
    // pipeline cai no PlaceholderProvider (degrada gracioso, sem hard-block).
    const key = await this.llm.resolveOpenAiKey(orgId, { allowNull: true });
    return Boolean(key);
  }

  async generate(orgId: string, input: GenerateImageInput): Promise<GeneratedImage> {
    const apiKey = await this.llm.resolveOpenAiKey(orgId, { allowNull: true });
    if (!apiKey) {
      throw new Error('Sem chave OpenAI configurada pra esta org (BYOK)');
    }

    const targetW = input.width ?? 1024;
    const targetH = input.height ?? 1024;
    const apiSize = pickImageSize(targetW, targetH);

    // Reforça cores da marca no prompt + impede texto na imagem.
    // gpt-image-1 é bem mais sensível a esses prompts negativos que o dall-e-3.
    const enrichedPrompt = `${input.prompt}\n\nEstilo: cores principais ${input.primaryColor} e ${input.secondaryColor}, design profissional, alta qualidade, sem texto na imagem, sem letras, sem palavras.`;

    try {
      const res = await fetch('https://api.openai.com/v1/images/generations', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'gpt-image-1',
          prompt: enrichedPrompt.slice(0, 4000),
          n: 1,
          size: apiSize.label,
          // gpt-image-1 retorna sempre b64_json por default — sem response_format.
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI image gen falhou: ${res.status} ${await res.text().catch(() => '')}`);
      }
      const body = (await res.json()) as { data?: Array<{ url?: string; b64_json?: string }> };
      const item = body.data?.[0];
      let raw: Buffer;
      if (item?.b64_json) {
        raw = Buffer.from(item.b64_json, 'base64');
      } else if (item?.url) {
        const imgRes = await fetch(item.url);
        if (!imgRes.ok) throw new Error(`Download da imagem OpenAI falhou: ${imgRes.status}`);
        const arr = await imgRes.arrayBuffer();
        raw = Buffer.from(arr);
      } else {
        throw new Error('Resposta sem url nem b64_json');
      }

      // Crop pro tamanho solicitado (cover fit, centralizado).
      // Se o aspect já bate (ex: pediu 1024x1024 e gerou 1024x1024), sharp
      // só re-encoda em PNG e segue. Sem isso, a capa do blog viria
      // 1536x1024 quando o consumer pediu 1200x630.
      const finalBuffer = await sharp(raw)
        .resize(targetW, targetH, { fit: 'cover', position: 'centre' })
        .png({ quality: 92 })
        .toBuffer();

      return {
        buffer: finalBuffer,
        mimeType: 'image/png',
        provider: 'openai',
        width: targetW,
        height: targetH,
        ext: 'png',
      };
    } catch (err) {
      this.log.warn(`OpenAI image gen falhou (org=${orgId}): ${String(err)}`);
      throw err;
    }
  }
}

/**
 * gpt-image-1 só aceita 3 tamanhos. Escolhemos o que tem aspect ratio mais
 * próximo do solicitado, pra perder o mínimo possível no crop.
 *
 *   1024x1024 (1.0)    — quadrado
 *   1536x1024 (~1.5)   — landscape (capa de blog, OG image)
 *   1024x1536 (~0.67)  — portrait (story, reels)
 */
function pickImageSize(w: number, h: number): { w: number; h: number; label: string } {
  const want = w / h;
  const options = [
    { w: 1024, h: 1024, label: '1024x1024', ratio: 1.0 },
    { w: 1536, h: 1024, label: '1536x1024', ratio: 1536 / 1024 },
    { w: 1024, h: 1536, label: '1024x1536', ratio: 1024 / 1536 },
  ];
  let best = options[0];
  let bestDelta = Math.abs(want - best.ratio);
  for (const opt of options.slice(1)) {
    const delta = Math.abs(want - opt.ratio);
    if (delta < bestDelta) {
      best = opt;
      bestDelta = delta;
    }
  }
  return best;
}
