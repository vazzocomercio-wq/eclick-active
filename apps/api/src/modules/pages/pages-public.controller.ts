import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PagePublic, StoreOrder, StoreProduct } from '@eclick-active/shared';
import { PagesService } from './pages.service';
import { StoreProductsService } from './store-products.service';
import { StoreOrdersService } from './store-orders.service';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CreateOrderDto, TrackVisitDto } from './dto/page.dto';

const ORDER_RATE_LIMIT_PER_HOUR = 5;
const VISIT_RATE_LIMIT_PER_MIN = 60;

interface RateBucket {
  count: number;
  windowStart: number;
}

@Controller('p')
export class PagesPublicController {
  /** Rate limit em memória por (page, ip) */
  private readonly orderLimits = new Map<string, RateBucket>();
  private readonly visitLimits = new Map<string, RateBucket>();

  constructor(
    private readonly pages: PagesService,
    private readonly products: StoreProductsService,
    private readonly orders: StoreOrdersService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * GET /p/:slug — retorna o HTML estático compilado.
   * Servido como text/html, sem auth, com Cache-Control de 5 minutos.
   * Em produção pode ficar atrás de CDN (Cloudflare/Vercel Edge).
   */
  @Get(':slug')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', 'public, max-age=60, s-maxage=300')
  async render(@Param('slug') slug: string, @Res() res: Response): Promise<void> {
    const page = await this.pages.findActiveBySlug(slug);
    if (!page) {
      res.status(404).send(this.notFoundHtml());
      return;
    }
    if (!page.published_html) {
      // Página existe mas não foi publicada ainda → mostra placeholder
      res.status(200).send(this.placeholderHtml(page.name));
      return;
    }
    res.status(200).send(page.published_html);
  }

  /**
   * GET /p/:slug/data — retorna o JSON da página (sem published_html).
   * Útil pra preview/SPA rendering em iframe ou debugging.
   */
  @Get(':slug/data')
  async getData(@Param('slug') slug: string): Promise<PagePublic> {
    const page = await this.pages.findActiveBySlug(slug);
    if (!page) throw new NotFoundException();
    return this.pages.toPublic(page);
  }

  /**
   * GET /p/:slug/products — lista produtos ativos da loja (público).
   */
  @Get(':slug/products')
  async listProducts(@Param('slug') slug: string): Promise<StoreProduct[]> {
    const page = await this.pages.findActiveBySlug(slug);
    if (!page) throw new NotFoundException();
    return this.products.listPublic(page.id);
  }

  /**
   * POST /p/:slug/order — cria pedido. Rate-limited por IP.
   * Rate limit: 5 pedidos/hora por (slug, IP).
   */
  @Post(':slug/order')
  @HttpCode(HttpStatus.OK)
  async createOrder(
    @Param('slug') slug: string,
    @Body() dto: CreateOrderDto,
    @Headers('x-forwarded-for') xff: string | undefined,
    @Req() req: Request,
  ): Promise<{ success: true; order_number: number; order_id: string }> {
    const page = await this.pages.findActiveBySlug(slug);
    if (!page) throw new NotFoundException('Página não disponível');

    const ip = (xff?.split(',')[0]?.trim() ?? req.ip ?? 'unknown').slice(0, 64);
    if (!this.checkRateLimit(this.orderLimits, `${slug}::${ip}`, ORDER_RATE_LIMIT_PER_HOUR, 3600_000)) {
      throw new HttpException(
        'Muitas tentativas. Aguarde 1 hora.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const order = await this.orders.create({
      pageId: page.id,
      orgId: page.org_id,
      page,
      dto,
      ipAddress: ip,
      userAgent: req.headers['user-agent']?.slice(0, 500),
    });

    return { success: true, order_number: order.order_number, order_id: order.id };
  }

  /**
   * POST /p/:slug/visit — registra visita. Rate-limit por IP (60/min).
   */
  @Post(':slug/visit')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trackVisit(
    @Param('slug') slug: string,
    @Body() dto: TrackVisitDto,
    @Headers('x-forwarded-for') xff: string | undefined,
    @Headers('user-agent') ua: string | undefined,
    @Req() req: Request,
  ): Promise<void> {
    const page = await this.pages.findActiveBySlug(slug);
    if (!page) return; // Não vaza 404 pra tracker

    const ip = (xff?.split(',')[0]?.trim() ?? req.ip ?? 'unknown').slice(0, 64);
    if (!this.checkRateLimit(this.visitLimits, `${slug}::${ip}`, VISIT_RATE_LIMIT_PER_MIN, 60_000)) {
      return; // silently drop
    }

    const referrerHost = (() => {
      try {
        return dto.referrer ? new URL(dto.referrer).hostname : null;
      } catch {
        return null;
      }
    })();

    await this.supabase.adminClient.from('page_visits').insert({
      page_id: page.id,
      org_id: page.org_id,
      visitor_id: dto.visitor_id ?? null,
      session_id: dto.session_id ?? null,
      source: referrerHost ?? null,
      utm_source: dto.utm_source ?? null,
      utm_medium: dto.utm_medium ?? null,
      utm_campaign: dto.utm_campaign ?? null,
      utm_content: dto.utm_content ?? null,
      utm_term: dto.utm_term ?? null,
      referrer: dto.referrer?.slice(0, 500) ?? null,
      device: dto.device ?? null,
      browser: (dto.browser ?? ua)?.slice(0, 200) ?? null,
      duration_seconds: dto.duration_seconds ?? null,
      scroll_depth_pct: dto.scroll_depth_pct ?? null,
    });
  }

  // ──────────────────────────────────────────────────────────

  private checkRateLimit(
    map: Map<string, RateBucket>,
    key: string,
    limit: number,
    windowMs: number,
  ): boolean {
    const now = Date.now();
    const bucket = map.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      map.set(key, { count: 1, windowStart: now });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }

  private notFoundHtml(): string {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Página não encontrada</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0A0A0F;color:#F5F5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}h1{font-size:6rem;margin:0;color:#00E5FF}p{color:rgba(255,255,255,0.6);margin-top:8px}</style></head><body><div><h1>404</h1><p>Esta página não está disponível ou foi removida.</p></div></body></html>`;
  }

  private placeholderHtml(name: string): string {
    return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${name}</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#0A0A0F;color:#F5F5F7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;text-align:center;padding:24px}h1{margin:0 0 16px;color:#00E5FF}p{color:rgba(255,255,255,0.6)}</style></head><body><div><h1>${name}</h1><p>Em breve. Esta página ainda não foi publicada.</p></div></body></html>`;
  }
}
