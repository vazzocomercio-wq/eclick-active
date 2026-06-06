import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ImageGenerationService } from '../../social/image-generation/image-generation.service';

export interface BuildThumbnailInput {
  /** Título grande que vai na capa (não precisa ser o título do vídeo). */
  title: string;
  /** Prompt do fundo gerado por IA (cena/contexto, SEM texto). */
  bgPrompt: string;
  /**
   * Imagem do avatar pra sobrepor. Se YOUTUBE_BRAND_AVATAR_CUTOUT_URL estiver
   * setada (PNG transparente da marca), ela tem prioridade e entra recortada.
   * Senão, usa esta URL (ex: thumbnail do HeyGen) como "card" com cantos
   * arredondados (sem transparência).
   */
  avatarImageUrl?: string | null;
  primaryColor?: string;
  secondaryColor?: string;
}

export interface BuiltThumbnail {
  url: string;
  storage_path: string;
  width: number;
  height: number;
}

const W = 1280;
const H = 720;
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 dias

/**
 * Monta a MINIATURA (capa 1280x720) do vídeo longo do YouTube:
 *   fundo gerado por IA  +  avatar por cima  +  título grande legível.
 *
 * O avatar entra com transparência quando há um recorte da marca configurado
 * (env YOUTUBE_BRAND_AVATAR_CUTOUT_URL); senão entra como card arredondado a
 * partir de um frame do vídeo — atende "com ou sem transparência".
 *
 * Composição feita com sharp (mesma lib já usada no pipeline de imagens). O
 * texto é SVG (as fontes do container já renderizam — o PlaceholderProvider
 * depende disso).
 */
@Injectable()
export class YouTubeThumbnailService {
  private readonly log = new Logger(YouTubeThumbnailService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly imageGen: ImageGenerationService,
  ) {}

  async build(orgId: string, input: BuildThumbnailInput): Promise<BuiltThumbnail> {
    const primary = input.primaryColor ?? '#00E5FF';
    const secondary = input.secondaryColor ?? '#0a0a0e';

    // 1. Fundo gerado por IA (16:9). Reusa a chain (OpenAI → Canva → placeholder).
    const bgBuffer = await this.generateBackground(orgId, input.bgPrompt, primary, secondary);
    let base = sharp(bgBuffer).resize(W, H, { fit: 'cover', position: 'centre' });

    const layers: sharp.OverlayOptions[] = [];

    // 2. Scrim — degradê escuro à esquerda/baixo pra dar contraste ao texto.
    layers.push({ input: Buffer.from(this.scrimSvg()), top: 0, left: 0 });

    // 3. Avatar (recorte transparente da marca OU card do frame HeyGen).
    const avatar = await this.prepareAvatar(input.avatarImageUrl, primary);
    if (avatar) {
      layers.push({
        input: avatar.buffer,
        top: H - avatar.height, // alinhado no rodapé
        left: W - avatar.width - 24, // encostado à direita, com respiro
      });
    }

    // 4. Título grande (esquerda), com sombra pra legibilidade + acento da marca.
    layers.push({
      input: Buffer.from(this.titleSvg(input.title, primary)),
      top: 0,
      left: 0,
    });

    const finalBuffer = await base
      .composite(layers)
      .jpeg({ quality: 88, mozjpeg: true }) // jpeg mantém < 2MB (limite do YouTube)
      .toBuffer();

    return this.upload(orgId, finalBuffer);
  }

  // ── Fundo ──────────────────────────────────────────────────

  private async generateBackground(
    orgId: string,
    prompt: string,
    primary: string,
    secondary: string,
  ): Promise<Buffer> {
    const gen = await this.imageGen.generateAndUpload(
      orgId,
      {
        prompt: `${prompt}. Cena cinematográfica, profissional, alto contraste, espaço livre à esquerda para texto, sem pessoas em primeiro plano, sem texto.`,
        primaryColor: primary,
        secondaryColor: secondary,
        width: W,
        height: H,
      },
      'youtube-thumbs/bg',
    );
    const res = await fetch(gen.url, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`Falha ao baixar o fundo gerado (HTTP ${res.status})`);
    // sharp normaliza SVG (placeholder) ou PNG (OpenAI) pra raster.
    return Buffer.from(await res.arrayBuffer());
  }

  // ── Avatar ─────────────────────────────────────────────────

  private async prepareAvatar(
    avatarImageUrl: string | null | undefined,
    primary: string,
  ): Promise<{ buffer: Buffer; width: number; height: number } | null> {
    const cutoutUrl = process.env.YOUTUBE_BRAND_AVATAR_CUTOUT_URL?.trim();
    const transparent = Boolean(cutoutUrl);
    const sourceUrl = cutoutUrl || avatarImageUrl;
    if (!sourceUrl) return null;

    let raw: Buffer;
    try {
      const res = await fetch(sourceUrl, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      this.log.warn(`[thumb] avatar indisponível (${String(err)}) — capa sem avatar`);
      return null;
    }

    try {
      if (transparent) {
        // Recorte transparente: encaixa pela ALTURA (até 680px), preserva alpha.
        const resized = await sharp(raw)
          .resize({ height: 680, fit: 'inside', withoutEnlargement: false })
          .png()
          .toBuffer();
        const meta = await sharp(resized).metadata();
        return { buffer: resized, width: meta.width ?? 480, height: meta.height ?? 680 };
      }
      // Sem transparência: card 460x600 com cantos arredondados + borda da marca.
      const cardW = 460;
      const cardH = 600;
      const r = 28;
      const photo = await sharp(raw)
        .resize(cardW, cardH, { fit: 'cover', position: 'centre' })
        .toBuffer();
      const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}"><rect x="0" y="0" width="${cardW}" height="${cardH}" rx="${r}" ry="${r}" fill="#fff"/></svg>`;
      const rounded = await sharp(photo)
        .composite([{ input: Buffer.from(maskSvg), blend: 'dest-in' }])
        .png()
        .toBuffer();
      const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${cardW}" height="${cardH}"><rect x="3" y="3" width="${cardW - 6}" height="${cardH - 6}" rx="${r}" ry="${r}" fill="none" stroke="${primary}" stroke-width="6"/></svg>`;
      const withBorder = await sharp(rounded)
        .composite([{ input: Buffer.from(borderSvg), top: 0, left: 0 }])
        .png()
        .toBuffer();
      return { buffer: withBorder, width: cardW, height: cardH };
    } catch (err) {
      this.log.warn(`[thumb] preparar avatar falhou (${String(err)})`);
      return null;
    }
  }

  // ── SVG overlays ───────────────────────────────────────────

  private scrimSvg(): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="s" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="rgba(0,0,0,0.78)"/>
      <stop offset="55%" stop-color="rgba(0,0,0,0.45)"/>
      <stop offset="100%" stop-color="rgba(0,0,0,0)"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#s)"/>
</svg>`;
  }

  private titleSvg(title: string, primary: string): string {
    const text = (title || '').trim().toUpperCase();
    const lines = wrapText(escapeXml(text), 16).slice(0, 3);
    const fontSize = lines.length >= 3 ? 78 : 92;
    const lineHeight = fontSize + 14;
    const blockH = lines.length * lineHeight;
    const startY = Math.floor((H - blockH) / 2 + fontSize);
    const x = 64;

    const lineSvg = lines
      .map((line, i) => {
        const y = startY + i * lineHeight;
        // sombra (offset) + texto branco por cima = legível sobre qualquer fundo.
        return (
          `<text x="${x + 4}" y="${y + 4}" fill="rgba(0,0,0,0.65)">${line}</text>` +
          `<text x="${x}" y="${y}" fill="#ffffff">${line}</text>`
        );
      })
      .join('\n      ');

    // Barra de acento da marca acima do título.
    const barY = startY - fontSize - 22;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect x="${x}" y="${barY}" width="120" height="10" rx="5" fill="${primary}"/>
  <g font-family="system-ui, -apple-system, 'Segoe UI', 'Arial', sans-serif" font-weight="800" font-size="${fontSize}" text-anchor="start">
      ${lineSvg}
  </g>
  <text x="${x}" y="${H - 44}" font-family="system-ui, sans-serif" font-weight="800" font-size="34" fill="${primary}">e-Click</text>
</svg>`;
  }

  // ── Storage ────────────────────────────────────────────────

  private async upload(orgId: string, buffer: Buffer): Promise<BuiltThumbnail> {
    const storagePath = `${orgId}/youtube-thumbs/${randomUUID()}.jpg`;
    const { error: upErr } = await this.supabase.adminClient.storage
      .from('social-media')
      .upload(storagePath, buffer, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw upErr;
    const { data: signed, error: signErr } = await this.supabase.adminClient.storage
      .from('social-media')
      .createSignedUrl(storagePath, SIGNED_URL_TTL);
    if (signErr || !signed) throw signErr ?? new Error('createSignedUrl falhou');
    return { url: signed.signedUrl, storage_path: storagePath, width: W, height: H };
  }
}

// ── helpers ───────────────────────────────────────────────────

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
    if (current.length === 0) current = w;
    else if (current.length + 1 + w.length <= maxLineLength) current += ' ' + w;
    else {
      lines.push(current);
      current = w;
    }
  }
  if (current) lines.push(current);
  return lines;
}
