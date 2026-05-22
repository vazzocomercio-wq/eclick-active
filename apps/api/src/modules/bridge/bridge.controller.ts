import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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
}
