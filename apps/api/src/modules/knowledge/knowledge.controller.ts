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
import type { ProductCatalogItem } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import type { PaginatedResult } from '../contacts/contacts.service';
import {
  KnowledgeService,
  type KnowledgeDocumentListItem,
  type SemanticSearchHit,
} from './knowledge.service';
import { ProductsService } from './products.service';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.query.dto';
import { SemanticSearchDto } from './dto/search.dto';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto';

@UseGuards(AuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly products: ProductsService,
  ) {}

  // ──────────────────────────────────────────────────────────
  // Products — declarado ANTES de :id pra não colidir com /:id
  // ──────────────────────────────────────────────────────────

  @Get('products')
  listProducts(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductCatalogItem>> {
    return this.products.findAll(user.org_id, filters);
  }

  @Post('products')
  @HttpCode(HttpStatus.CREATED)
  createProduct(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProductDto,
  ): Promise<ProductCatalogItem> {
    return this.products.create(user.org_id, dto);
  }

  @Get('products/:id')
  getProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ProductCatalogItem> {
    return this.products.findById(user.org_id, id);
  }

  @Patch('products/:id')
  updateProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProductDto,
  ): Promise<ProductCatalogItem> {
    return this.products.update(user.org_id, id, dto);
  }

  @Delete('products/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteProduct(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.products.delete(user.org_id, id);
  }

  // ──────────────────────────────────────────────────────────
  // Search — declarado ANTES de :id
  // ──────────────────────────────────────────────────────────

  @Post('search')
  @HttpCode(HttpStatus.OK)
  search(
    @CurrentUser() user: AuthUser,
    @Body() dto: SemanticSearchDto,
  ): Promise<SemanticSearchHit[]> {
    return this.service.searchSemantic(user.org_id, dto.query, dto.limit);
  }

  // ──────────────────────────────────────────────────────────
  // Documents
  // ──────────────────────────────────────────────────────────

  @Get()
  list(
    @CurrentUser() user: AuthUser,
    @Query() filters: ListDocumentsQueryDto,
  ): Promise<PaginatedResult<KnowledgeDocumentListItem>> {
    return this.service.findAll(user.org_id, filters);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateDocumentDto,
  ): Promise<KnowledgeDocumentListItem> {
    return this.service.createDocument(user.org_id, dto, user.id);
  }

  @Get(':id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<KnowledgeDocumentListItem> {
    return this.service.findById(user.org_id, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateDocumentDto,
  ): Promise<KnowledgeDocumentListItem> {
    return this.service.update(user.org_id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.service.delete(user.org_id, id);
  }
}
