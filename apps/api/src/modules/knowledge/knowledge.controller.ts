import {
  BadRequestException,
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
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { KnowledgeLiveSource, ProductCatalogItem } from '@eclick-active/shared';
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
import { LiveSourcesService } from './live-sources.service';
import { CreateDocumentDto, UpdateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents.query.dto';
import { SemanticSearchDto } from './dto/search.dto';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import {
  ImportUrlBatchConfirmDto,
  ImportUrlBatchDto,
  ImportUrlConfirmDto,
  ImportUrlPreviewDto,
} from './dto/import-url.dto';
import { ConfirmFileUploadDto } from './dto/upload-file.dto';
import { CreateLiveSourceDto, UpdateLiveSourceDto } from './dto/live-source.dto';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB
const ACCEPTED_EXTENSIONS = /\.(pdf|xlsx|xls|csv|docx|txt|md)$/i;

interface MulterFile {
  fieldname: string;
  originalname: string;
  encoding: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

@UseGuards(AuthGuard)
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly service: KnowledgeService,
    private readonly products: ProductsService,
    private readonly liveSources: LiveSourcesService,
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
  // URL Import — declarados ANTES de :id pra não colidir
  // ──────────────────────────────────────────────────────────

  @Post('import-url')
  @HttpCode(HttpStatus.OK)
  previewUrl(@Body() dto: ImportUrlPreviewDto) {
    return this.service.previewUrl(dto.url);
  }

  @Post('import-url/confirm')
  @HttpCode(HttpStatus.CREATED)
  confirmImport(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportUrlConfirmDto,
  ): Promise<KnowledgeDocumentListItem> {
    return this.service.confirmUrlImport(
      user.org_id,
      {
        url: dto.url,
        title: dto.title,
        content: dto.content,
        ...(dto.category ? { category: dto.category } : {}),
      },
      user.id,
    );
  }

  @Post('import-url/batch')
  @HttpCode(HttpStatus.OK)
  batchPreview(@Body() dto: ImportUrlBatchDto) {
    return this.service.batchPreview(dto.urls);
  }

  @Post('import-url/batch/confirm')
  @HttpCode(HttpStatus.CREATED)
  batchConfirm(
    @CurrentUser() user: AuthUser,
    @Body() dto: ImportUrlBatchConfirmDto,
  ): Promise<KnowledgeDocumentListItem[]> {
    return this.service.confirmBatchImport(user.org_id, dto.items, dto.category, user.id);
  }

  // ──────────────────────────────────────────────────────────
  // FILE UPLOAD — Feature A
  // ──────────────────────────────────────────────────────────

  /** Step 1: extrai conteúdo do arquivo, retorna preview pra revisão. */
  @Post('upload')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async uploadFile(@UploadedFile() file: MulterFile | undefined) {
    if (!file) {
      throw new BadRequestException('Nenhum arquivo recebido (campo "file" no multipart).');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`Arquivo maior que 10MB (recebido ${(file.size / 1024 / 1024).toFixed(1)}MB).`);
    }
    if (!ACCEPTED_EXTENSIONS.test(file.originalname)) {
      throw new BadRequestException(
        'Tipo de arquivo não suportado. Aceitos: .pdf, .xlsx, .xls, .csv, .docx, .txt, .md',
      );
    }
    return this.service.previewFileUpload({
      filename: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });
  }

  /** Step 2: confirma e salva (com chunking automático se >8000 tokens). */
  @Post('upload/confirm')
  @HttpCode(HttpStatus.CREATED)
  confirmUpload(
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmFileUploadDto,
  ): Promise<KnowledgeDocumentListItem[]> {
    return this.service.confirmFileUpload(
      user.org_id,
      {
        filename: dto.filename,
        title: dto.title,
        content: dto.content,
        ...(dto.category ? { category: dto.category } : {}),
        ...(dto.file_type ? { file_type: dto.file_type } : {}),
        ...(dto.file_size !== undefined ? { file_size: dto.file_size } : {}),
        ...(dto.pages_count !== undefined ? { pages_count: dto.pages_count } : {}),
        ...(dto.selected_sheets ? { selected_sheets: dto.selected_sheets } : {}),
      },
      user.id,
    );
  }

  // ──────────────────────────────────────────────────────────
  // LIVE SOURCES — Feature B
  // ──────────────────────────────────────────────────────────

  @Get('live-sources')
  listLiveSources(@CurrentUser() user: AuthUser): Promise<KnowledgeLiveSource[]> {
    return this.liveSources.list(user.org_id);
  }

  @Post('live-sources')
  @HttpCode(HttpStatus.CREATED)
  createLiveSource(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateLiveSourceDto,
  ): Promise<KnowledgeLiveSource> {
    return this.liveSources.create(user.org_id, dto);
  }

  @Patch('live-sources/:id')
  updateLiveSource(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateLiveSourceDto,
  ): Promise<KnowledgeLiveSource> {
    return this.liveSources.update(user.org_id, id, dto);
  }

  @Delete('live-sources/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteLiveSource(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.liveSources.delete(user.org_id, id);
  }

  @Post('live-sources/:id/test')
  @HttpCode(HttpStatus.OK)
  testLiveSource(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.liveSources.test(user.org_id, id);
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

  @Post(':id/refresh')
  @HttpCode(HttpStatus.OK)
  refresh(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ updated: boolean; document: KnowledgeDocumentListItem }> {
    return this.service.refreshUrlDocument(user.org_id, id);
  }
}
