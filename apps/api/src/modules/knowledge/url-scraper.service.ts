import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import * as cheerio from 'cheerio';

export interface ScrapedContent {
  title: string;
  content: string;
  url: string;
  char_count: number;
  /** Aproximação grosseira: 1 token ≈ 4 chars (en-US). Em PT-BR fica próximo. */
  token_estimate: number;
  /** Foi truncado por causa do MAX_CHARS? */
  truncated: boolean;
}

const MAX_CHARS = 50_000;
const FETCH_TIMEOUT_MS = 10_000;
const USER_AGENT =
  'Mozilla/5.0 (compatible; eClick-Active-Bot/1.0; +https://active.eclick.app.br)';

/**
 * Scraper para a feature "Importar de URL" da Base de Conhecimento.
 *
 * Estratégia:
 *   1. fetch HTTP com timeout de 10s e User-Agent amigável
 *   2. Decode considerando charset (UTF-8 default; ISO-8859-1 quando declarado)
 *   3. Parse com cheerio + remoção de elementos ruidosos (scripts, nav, etc.)
 *   4. Extração ordenada: title → meta description → h1/h2/h3 → p → li → table
 *   5. Normalização de espaços + truncate em MAX_CHARS
 */
@Injectable()
export class UrlScraperService {
  private readonly logger = new Logger(UrlScraperService.name);

  // ────────────────────────────────────────────
  // Validate URL
  // ────────────────────────────────────────────

  validateUrl(raw: string): URL {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new BadRequestException('URL inválida');
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new BadRequestException('URL precisa ser http:// ou https://');
    }
    // Bloqueia loopback/privado por segurança (SSRF)
    const host = url.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.16.') ||
      host.endsWith('.local') ||
      host === '[::1]'
    ) {
      throw new BadRequestException('URL aponta pra rede privada/loopback');
    }
    return url;
  }

  // ────────────────────────────────────────────
  // Scrape
  // ────────────────────────────────────────────

  async scrape(rawUrl: string): Promise<ScrapedContent> {
    const url = this.validateUrl(rawUrl);

    let res: Response;
    try {
      res = await this.fetchWithTimeout(url.toString(), FETCH_TIMEOUT_MS);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new BadRequestException(
        `Não foi possível acessar a URL: ${this.friendlyError(msg)}`,
      );
    }

    if (!res.ok) {
      throw new BadRequestException(
        `URL retornou status ${res.status}. Verifique se a página existe e está pública.`,
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (!contentType.includes('html') && !contentType.includes('text')) {
      throw new BadRequestException(
        `Tipo de conteúdo não suportado: ${contentType}. Esperado HTML/texto.`,
      );
    }

    const html = await this.decodeBody(res, contentType);
    const extracted = this.extractContent(html, url.toString());

    return extracted;
  }

  // ────────────────────────────────────────────
  // fetch com timeout (AbortController)
  // ────────────────────────────────────────────

  private async fetchWithTimeout(urlStr: string, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(urlStr, {
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Decoda o body considerando charset declarado em headers ou meta.
   * Suporte explícito a ISO-8859-1 (comum em sites BR antigos).
   */
  private async decodeBody(res: Response, contentType: string): Promise<string> {
    const buf = await res.arrayBuffer();
    const charsetMatch = /charset=([^;]+)/i.exec(contentType);
    const declared = charsetMatch?.[1]?.trim().toLowerCase();

    // Tenta o charset declarado; cai pra utf-8
    const tryCharsets = [declared, 'utf-8', 'iso-8859-1'].filter((c): c is string => !!c);

    for (const charset of tryCharsets) {
      try {
        const decoder = new TextDecoder(charset, { fatal: false });
        const text = decoder.decode(buf);
        // Detecta meta charset HTML pra correção quando o header errou
        const metaMatch = /<meta[^>]+charset=["']?([\w-]+)/i.exec(text.slice(0, 2048));
        const metaCharset = metaMatch?.[1]?.toLowerCase();
        if (metaCharset && metaCharset !== charset) {
          try {
            return new TextDecoder(metaCharset, { fatal: false }).decode(buf);
          } catch {
            return text;
          }
        }
        return text;
      } catch {
        continue;
      }
    }
    // Last resort
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }

  // ────────────────────────────────────────────
  // Extração de conteúdo via cheerio
  // ────────────────────────────────────────────

  private extractContent(html: string, url: string): ScrapedContent {
    const $ = cheerio.load(html);

    // Título: <title> > og:title > h1
    const title =
      this.cleanText($('title').first().text()) ||
      this.cleanText($('meta[property="og:title"]').attr('content') ?? '') ||
      this.cleanText($('h1').first().text()) ||
      'Sem título';

    // Remove ruído antes de extrair
    $(
      'script, style, noscript, iframe, nav, footer, aside, form, ' +
        'button, [role="navigation"], [role="banner"], [aria-hidden="true"], ' +
        '.ad, .ads, .advertisement, [class*="cookie"]',
    ).remove();

    const parts: string[] = [];

    // Meta description
    const metaDesc = $('meta[name="description"]').attr('content');
    if (metaDesc) {
      parts.push(this.cleanText(metaDesc));
    }

    // Headings + paragraphs + lists + tables
    // Foca em <main>/<article> se existir; senão no body inteiro
    const mainSelector =
      $('main').length > 0 ? 'main' : $('article').length > 0 ? 'article' : 'body';
    const root = $(mainSelector).first();

    root.find('h1, h2, h3, p, li').each((_, el) => {
      const tag = (el as { tagName?: string }).tagName?.toLowerCase() ?? '';
      const formatted = this.formatElementWithLinks($, el, url);
      if (!formatted) return;
      if (tag.startsWith('h')) {
        parts.push(`\n## ${formatted}\n`);
      } else if (tag === 'li') {
        parts.push(`- ${formatted}`);
      } else {
        parts.push(formatted);
      }
    });

    // Tables → texto plano (linha a linha)
    root.find('table').each((_, table) => {
      const rows: string[] = [];
      $(table)
        .find('tr')
        .each((_, tr) => {
          const cells = $(tr)
            .find('th, td')
            .map((_, c) => this.formatElementWithLinks($, c, url))
            .get()
            .filter(Boolean);
          if (cells.length > 0) rows.push(cells.join(' | '));
        });
      if (rows.length > 0) {
        parts.push('\n' + rows.join('\n') + '\n');
      }
    });

    let content = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    let truncated = false;
    if (content.length > MAX_CHARS) {
      content = content.slice(0, MAX_CHARS).trim() + '\n\n[…conteúdo truncado em 50.000 caracteres]';
      truncated = true;
    }

    if (!content) {
      throw new BadRequestException(
        'Não foi possível extrair conteúdo desta página. Pode ser uma SPA (carrega via JS) ou o HTML não tem texto relevante.',
      );
    }

    return {
      title: title.slice(0, 200),
      content,
      url,
      char_count: content.length,
      token_estimate: Math.ceil(content.length / 4),
      truncated,
    };
  }

  // ────────────────────────────────────────────
  // Link-aware extraction (crítico pra catálogos/marketplaces — preserva
  // URLs de produtos junto com título/preço pra IA poder citar)
  // ────────────────────────────────────────────

  /**
   * Extrai texto de um elemento + URLs de `<a href>` dentro/em volta dele.
   * Retorna formato:
   *   - 1 URL: `[texto](url)` (markdown link — fácil pro LLM parsear)
   *   - 2-3 URLs: `texto → url1 | url2`
   *   - 0 URLs: texto puro
   *
   * Resolve URLs relativas usando `baseUrl`. Filtra anchors (#), javascript:,
   * mailto:, tel:, data:.
   */
  private formatElementWithLinks(
    $: cheerio.CheerioAPI,
    el: unknown,
    baseUrl: string,
  ): string {
    const $el = $(el as never);
    const text = this.cleanText($el.text());
    if (!text) return '';

    const seen = new Set<string>();
    const urls: string[] = [];

    // Caso 1: o próprio elemento é descendente de um <a> envolvente
    // (ex: <a href><li>...</li></a> — comum em listings de marketplace)
    const wrapping = $el.closest('a[href]');
    if (wrapping.length > 0) {
      const resolved = this.resolveUrl(wrapping.attr('href'), baseUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        urls.push(resolved);
      }
    }

    // Caso 2: <a href> descendentes do elemento
    $el.find('a[href]').each((_, a) => {
      const resolved = this.resolveUrl($(a).attr('href'), baseUrl);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        urls.push(resolved);
      }
    });

    // Limita a 3 URLs por elemento (evita bloat em pages com muitos links)
    const finalUrls = urls.slice(0, 3);
    if (finalUrls.length === 0) return text;
    if (finalUrls.length === 1) return `[${text}](${finalUrls[0]})`;
    return `${text} → ${finalUrls.join(' | ')}`;
  }

  /**
   * Resolve href relativo → absoluto e filtra protocolos não-navegáveis.
   * Retorna null se inválido/incompatível.
   */
  private resolveUrl(href: string | undefined, baseUrl: string): string | null {
    if (!href) return null;
    const trimmed = href.trim();
    if (!trimmed) return null;
    if (trimmed.startsWith('#')) return null;
    if (/^(javascript|mailto|tel|data):/i.test(trimmed)) return null;
    try {
      const u = new URL(trimmed, baseUrl);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.toString();
    } catch {
      return null;
    }
  }

  // ────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────

  private cleanText(s: string): string {
    return s
      .replace(/\s+/g, ' ')
      .replace(/ /g, ' ')
      .trim();
  }

  private friendlyError(msg: string): string {
    if (/abort/i.test(msg)) return 'tempo limite excedido (10s)';
    if (/getaddrinfo|enotfound/i.test(msg)) return 'domínio não encontrado';
    if (/econnrefused/i.test(msg)) return 'conexão recusada';
    if (/cert|ssl|tls/i.test(msg)) return 'certificado SSL inválido';
    return msg;
  }
}
