import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type {
  AiPageImprovement,
  Page,
  PageBlock,
  StoreOrder,
  StoreProduct,
} from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { PagesService } from './pages.service';
import { AiPageGeneratorService } from './ai-page-generator.service';
import { StoreProductsService } from './store-products.service';
import { StoreOrdersService } from './store-orders.service';
import {
  CreatePageDto,
  CreateStoreProductDto,
  GenerateBlockDto,
  GeneratePageDto,
  ImportCatalogDto,
  RewriteBlockDto,
  UpdateOrderDto,
  UpdatePageDto,
  UpdateStoreProductDto,
} from './dto/page.dto';

@UseGuards(AuthGuard)
@Controller('pages')
export class PagesController {
  constructor(
    private readonly pages: PagesService,
    private readonly ai: AiPageGeneratorService,
    private readonly products: StoreProductsService,
    private readonly orders: StoreOrdersService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // CRUD
  // ──────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query('page_type') pageType?: string,
    @Query('status') status?: string,
  ): Promise<Page[]> {
    return this.pages.list(user.org_id, {
      page_type: pageType as Page['page_type'] | undefined,
      status: status as Page['status'] | undefined,
    });
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePageDto,
  ): Promise<Page> {
    return this.pages.create(user.org_id, dto);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Page> {
    return this.pages.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePageDto,
  ): Promise<Page> {
    return this.pages.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.pages.delete(user.org_id, id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Page> {
    return this.pages.publish(user.org_id, id);
  }

  @Post(':id/unpublish')
  @HttpCode(HttpStatus.OK)
  unpublish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Page> {
    return this.pages.unpublish(user.org_id, id);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  duplicate(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Page> {
    return this.pages.duplicate(user.org_id, id);
  }

  // ──────────────────────────────────────────────────────────
  // AI generation
  // ──────────────────────────────────────────────────────────

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  async generate(
    @CurrentUser() user: AuthUser,
    @Body() dto: GeneratePageDto,
  ): Promise<Page> {
    const result = await this.ai.generatePage(user.org_id, dto);
    // Cria a página em estado draft já com os blocks gerados
    return this.pages.create(user.org_id, {
      name: result.name,
      page_type: result.page_type,
      blocks: result.blocks,
      global_styles: result.global_styles,
      seo: result.seo,
      ai_generated: true,
      metadata: result.metadata,
    });
  }

  @Post(':id/blocks/generate')
  @HttpCode(HttpStatus.OK)
  async generateBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GenerateBlockDto,
  ): Promise<PageBlock> {
    const page = await this.pages.findById(user.org_id, id);
    const block = await this.ai.generateBlock(
      user.org_id,
      dto.block_type ?? 'section',
      dto.description,
      page.blocks,
    );
    await this.pages.appendBlock(user.org_id, id, block);
    return block;
  }

  @Post(':id/blocks/:blockId/rewrite')
  @HttpCode(HttpStatus.OK)
  async rewriteBlock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('blockId') blockId: string,
    @Body() dto: RewriteBlockDto,
  ): Promise<Page> {
    const page = await this.pages.findById(user.org_id, id);
    const block = page.blocks.find((b) => b.id === blockId);
    if (!block) {
      const blocks = page.blocks;
      void blocks; // mantém pra debug
      throw new Error(`Block ${blockId} não encontrado`);
    }
    const newContent = await this.ai.rewriteBlockContent(user.org_id, block, dto.instruction);
    return this.pages.updateBlock(user.org_id, id, blockId, newContent);
  }

  @Post(':id/suggest-improvements')
  @HttpCode(HttpStatus.OK)
  async suggestImprovements(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<AiPageImprovement[]> {
    const page = await this.pages.findById(user.org_id, id);
    return this.ai.suggestImprovements(user.org_id, page);
  }

  @Get(':id/analytics')
  analytics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') daysStr?: string,
  ) {
    return this.pages.getAnalytics(user.org_id, id, daysStr ? Number(daysStr) : 30);
  }

  // ──────────────────────────────────────────────────────────
  // Store products (sub-resource)
  // ──────────────────────────────────────────────────────────

  @Get(':id/products')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StoreProduct[]> {
    return this.products.list(user.org_id, id);
  }

  @Post(':id/products')
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateStoreProductDto,
  ): Promise<StoreProduct> {
    return this.products.create(user.org_id, id, dto);
  }

  @Patch(':id/products/:productId')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateStoreProductDto,
  ): Promise<StoreProduct> {
    return this.products.update(user.org_id, id, productId, dto);
  }

  @Delete(':id/products/:productId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('productId', ParseUUIDPipe) productId: string,
  ): Promise<void> {
    return this.products.remove(user.org_id, id, productId);
  }

  @Post(':id/products/import-catalog')
  @HttpCode(HttpStatus.CREATED)
  importCatalog(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ImportCatalogDto,
  ): Promise<StoreProduct[]> {
    return this.products.importFromCatalog(user.org_id, id, dto);
  }

  @Post(':id/products/reorder')
  @HttpCode(HttpStatus.OK)
  async reorderProducts(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { ids: string[] },
  ): Promise<{ ok: true }> {
    await this.products.reorder(user.org_id, id, body.ids ?? []);
    return { ok: true };
  }

  // ──────────────────────────────────────────────────────────
  // Orders (sub-resource)
  // ──────────────────────────────────────────────────────────

  @Get(':id/orders')
  listOrders(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('payment_status') paymentStatus?: string,
    @Query('fulfillment_status') fulfillmentStatus?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ data: StoreOrder[]; total: number }> {
    return this.orders.list(user.org_id, id, {
      payment_status: paymentStatus,
      fulfillment_status: fulfillmentStatus,
      page: pageStr ? Number(pageStr) : undefined,
      limit: limitStr ? Number(limitStr) : undefined,
    });
  }

  @Get(':id/orders/:orderId')
  getOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ): Promise<StoreOrder> {
    return this.orders.findById(user.org_id, orderId);
  }

  @Patch(':id/orders/:orderId')
  updateOrder(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) _id: string,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: UpdateOrderDto,
  ): Promise<StoreOrder> {
    return this.orders.update(user.org_id, orderId, dto);
  }

  @Get(':id/orders-analytics')
  ordersAnalytics(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query('days') daysStr?: string,
  ) {
    return this.orders.getAnalytics(user.org_id, id, daysStr ? Number(daysStr) : 30);
  }
}
