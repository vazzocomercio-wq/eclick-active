import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { BridgeService } from './bridge.service';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { AuthGuard } from '../../common/auth/auth.guard';
import type { AuthUser } from '../../common/auth/auth.types';

/**
 * Endpoints da bridge cross-schema. Read-only — todas as respostas têm
 * fallback silencioso (vazio em vez de erro) quando o SaaS não está
 * disponível pra essa org.
 */
@UseGuards(AuthGuard)
@Controller('bridge')
export class BridgeController {
  constructor(private readonly bridge: BridgeService) {}

  @Get('status')
  status(@CurrentUser() user: AuthUser) {
    return this.bridge.getStatus(user.org_id);
  }

  @Get('orders')
  ordersByContact(
    @CurrentUser() user: AuthUser,
    @Query('phone') phone?: string,
    @Query('email') email?: string,
    @Query('nickname') nickname?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bridge.getOrdersByContact(user.org_id, {
      phone: phone ?? null,
      email: email ?? null,
      nickname: nickname ?? null,
      limit: limit ? Number(limit) : 20,
    });
  }

  @Get('orders/recent')
  recent(@CurrentUser() user: AuthUser, @Query('limit') limit?: string) {
    return this.bridge.getRecentOrders(
      user.org_id,
      limit ? Number(limit) : 10,
    );
  }

  @Get('orders/stats')
  stats(@CurrentUser() user: AuthUser, @Query('days') days?: string) {
    return this.bridge.getOrderStats(user.org_id, days ? Number(days) : 30);
  }

  @Get('orders/search')
  searchOrder(@CurrentUser() user: AuthUser, @Query('q') q: string) {
    return this.bridge.getOrderByQuery(user.org_id, q);
  }

  /** Lista produtos do catálogo do SaaS (seletor do Social AI Studio).
   *  Definido ANTES de :sku pra não ser capturado pela rota com param. */
  @Get('products')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.bridge.listProducts(user.org_id, {
      search: search ?? undefined,
      limit: limit ? Number(limit) : 60,
    });
  }

  @Get('products/:sku')
  productBySku(@CurrentUser() user: AuthUser, @Param('sku') sku: string) {
    return this.bridge.getProduct(user.org_id, { sku });
  }

  /** Lista designs do Canva da org (proxy pro SaaS, pra imagem do post). */
  @Get('canva/designs')
  async canvaDesigns(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
  ) {
    const designs = await this.bridge.listCanvaDesigns(user.org_id, q);
    return { designs };
  }

  /** Exporta um design do Canva como imagem https (proxy pro SaaS). */
  @Post('canva/export')
  async canvaExport(
    @CurrentUser() user: AuthUser,
    @Body() body: { design_id?: string },
  ) {
    const result = body?.design_id
      ? await this.bridge.exportCanvaDesign(user.org_id, body.design_id)
      : null;
    return result ?? { url: null };
  }

  /** Dispara a geração de um Reel pelo motor de vídeo do SaaS (proxy). */
  @Post('video/start')
  async startVideo(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      catalog_product_id?: string;
      product_title?: string;
      product_photo_url?: string;
      category?: string;
      mode?: 'product_photo' | 'ai_scene';
      prompt?: string;
      scene_prompt?: string;
      aspect_ratio?: '1:1' | '16:9' | '9:16';
      duration_seconds?: number;
      model_name?: string;
      camera_motion?: string;
      max_cost_usd?: number;
    },
  ) {
    if (!body?.product_photo_url || !body?.prompt) {
      return { job_id: null };
    }
    const result = await this.bridge.startSocialVideo(user.org_id, {
      product_photo_url: body.product_photo_url,
      prompt: body.prompt,
      mode: body.mode ?? 'product_photo',
      catalog_product_id: body.catalog_product_id,
      product_title: body.product_title,
      category: body.category,
      scene_prompt: body.scene_prompt,
      aspect_ratio: body.aspect_ratio,
      duration_seconds: body.duration_seconds,
      model_name: body.model_name,
      camera_motion: body.camera_motion,
      max_cost_usd: body.max_cost_usd,
    });
    return result ?? { job_id: null };
  }

  /** Status do job de Reel (poll). */
  @Get('video/:jobId')
  async videoStatus(
    @CurrentUser() user: AuthUser,
    @Param('jobId') jobId: string,
  ) {
    const result = await this.bridge.getSocialVideo(user.org_id, jobId);
    return result ?? { status: 'unknown', public_url: null, preview_url: null, error: null };
  }
}
