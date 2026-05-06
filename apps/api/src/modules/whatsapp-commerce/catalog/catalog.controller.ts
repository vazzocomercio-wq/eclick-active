import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
  NotFoundException,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { CatalogService } from './catalog.service';
import { CommerceSettingsService } from '../settings/commerce-settings.service';
import type { WhatsAppCatalogConfig } from './catalog.types';

@UseGuards(AuthGuard)
@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly settings: CommerceSettingsService,
  ) {}

  @Get('products')
  list(
    @CurrentUser() user: AuthUser,
    @Query('q') q?: string,
    @Query('category') category?: string,
    @Query('min_price') minPrice?: string,
    @Query('max_price') maxPrice?: string,
    @Query('in_stock_only') inStockOnly?: string,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.catalog.list(user.org_id, {
      query: q,
      category,
      min_price: minPrice ? Number(minPrice) : undefined,
      max_price: maxPrice ? Number(maxPrice) : undefined,
      in_stock_only: inStockOnly !== 'false',
      limit,
    });
  }

  @Get('products/featured')
  featured(
    @CurrentUser() user: AuthUser,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    return this.catalog.featured(user.org_id, limit ?? 10);
  }

  @Get('products/search')
  async search(
    @CurrentUser() user: AuthUser,
    @Query('q') q: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    return this.catalog.list(user.org_id, { query: q, limit });
  }

  @Get('products/:id')
  async getOne(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const p = await this.catalog.getById(user.org_id, id);
    if (!p) throw new NotFoundException('Produto não encontrado no catálogo');
    return p;
  }

  // ─── WhatsApp config por produto ────────────────

  @Get('whatsapp-config')
  listConfigs(@CurrentUser() user: AuthUser) {
    return this.catalog.listConfigs(user.org_id);
  }

  @Get('products/:id/whatsapp-config')
  getConfig(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.catalog.getConfig(user.org_id, id);
  }

  @Post('products/:id/whatsapp-config')
  createConfig(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<WhatsAppCatalogConfig>,
  ) {
    return this.catalog.upsertConfig(user.org_id, id, body);
  }

  @Patch('products/:id/whatsapp-config')
  updateConfig(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<WhatsAppCatalogConfig>,
  ) {
    return this.catalog.upsertConfig(user.org_id, id, body);
  }
}

@UseGuards(AuthGuard)
@Controller('whatsapp-commerce/settings')
export class CommerceSettingsController {
  constructor(private readonly settings: CommerceSettingsService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.settings.get(user.org_id);
  }

  @Patch()
  update(
    @CurrentUser() user: AuthUser,
    @Body() body: Record<string, unknown>,
  ) {
    return this.settings.update(user.org_id, body);
  }
}
