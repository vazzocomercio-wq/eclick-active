import {
  BadRequestException,
  Controller,
  Get,
  Logger,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';

/**
 * Proxy de thumbnails do Radar de Conteúdo.
 *
 * As capas do Instagram/TikTok são servidas por CDNs que BLOQUEIAM hotlink
 * (referer/CORS) → a tag <img> de outro domínio falha. Aqui buscamos a imagem
 * server-side e servimos do nosso domínio.
 *
 * PÚBLICO de propósito: a <img> do browser não manda o Authorization header.
 * Proteção anti-SSRF: só busca hosts de CDN de imagem conhecidos (allowlist) e
 * só devolve content-type image/*. Sem cookies, sem seguir hosts arbitrários.
 */
const ALLOWED_HOST =
  /(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn\.com|tiktokcdn-us\.com|ttwstatic\.com|ibyteimg\.com|muscdn\.com)$/i;

@Controller('public/social/trends')
export class TrendsThumbController {
  private readonly log = new Logger(TrendsThumbController.name);

  @Get('thumb')
  async thumb(@Query('u') u: string, @Res() res: Response): Promise<void> {
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      throw new BadRequestException('url inválida');
    }
    if (url.protocol !== 'https:' || !ALLOWED_HOST.test(url.hostname)) {
      throw new BadRequestException('host não permitido');
    }

    try {
      const r = await fetch(url.toString(), {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/*,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(8000),
      });
      const ct = r.headers.get('content-type') ?? '';
      if (!r.ok || !ct.startsWith('image/')) {
        res.status(404).end();
        return;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8_000_000) {
        res.status(413).end();
        return;
      }
      res.setHeader('Content-Type', ct);
      // cache 1 dia no browser/CDN (a URL de origem expira, mas a cópia segura)
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.end(buf);
    } catch (e) {
      this.log.warn(`thumb proxy falhou (${url.hostname}): ${(e as Error).message}`);
      res.status(404).end();
    }
  }
}
