import { Injectable } from '@nestjs/common';
import type {
  GeneratedImage,
  GenerateImageInput,
  ImageProvider,
} from '../image-generation.types';

/**
 * Provider de fallback que sempre funciona — gera SVG com gradient da
 * marca + overlay de texto em fonte grande. Usado quando Canva/OpenAI
 * não estão configurados ou falham.
 *
 * SVG é leve (~2KB), não consome créditos, renderiza no browser direto.
 * Identificável visualmente: tem badge "PLACEHOLDER" pequeno no canto
 * pra não confundir com produção.
 */
@Injectable()
export class PlaceholderImageProvider implements ImageProvider {
  readonly name = 'placeholder' as const;

  async isAvailable(): Promise<boolean> {
    return true; // Sempre disponível
  }

  async generate(_orgId: string, input: GenerateImageInput): Promise<GeneratedImage> {
    const width = input.width ?? 1080;
    const height = input.height ?? 1080;
    const text = (input.overlayText ?? input.prompt).slice(0, 60).trim() || 'Conteúdo';
    const escaped = escapeXml(text);

    // Quebra texto em linhas de até ~22 chars pra caber no quadrado
    const lines = wrapText(escaped, 22);
    const lineHeight = 80;
    const totalH = lines.length * lineHeight;
    const startY = Math.floor((height - totalH) / 2 + lineHeight / 2);

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${input.primaryColor}"/>
      <stop offset="100%" stop-color="${input.secondaryColor}"/>
    </linearGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#g)"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-weight="700" fill="white" text-anchor="middle">
    ${lines
      .map(
        (line, i) =>
          `<text x="${width / 2}" y="${startY + i * lineHeight}" font-size="64">${line}</text>`,
      )
      .join('\n    ')}
  </g>
  <text x="${width - 16}" y="${height - 16}" font-family="monospace" font-size="14" fill="rgba(255,255,255,0.6)" text-anchor="end">PLACEHOLDER</text>
</svg>`;

    return {
      buffer: Buffer.from(svg, 'utf-8'),
      mimeType: 'image/svg+xml',
      provider: 'placeholder',
      width,
      height,
      ext: 'svg',
    };
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapText(text: string, maxLineLength: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    if (current.length === 0) {
      current = w;
    } else if (current.length + 1 + w.length <= maxLineLength) {
      current += ' ' + w;
    } else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 4); // Max 4 linhas
}
