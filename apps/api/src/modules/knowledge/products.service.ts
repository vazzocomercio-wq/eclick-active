import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { ProductCatalogItem } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateProductDto,
  ListProductsQueryDto,
  UpdateProductDto,
} from './dto/product.dto';
import type { PaginatedResult } from '../contacts/contacts.service';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger(ProductsService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async create(orgId: string, dto: CreateProductDto): Promise<ProductCatalogItem> {
    const { data, error } = await this.supabase.adminClient
      .from('products_catalog')
      .insert({
        org_id: orgId,
        name: dto.name,
        sku: dto.sku ?? null,
        description: dto.description ?? null,
        price: dto.price ?? null,
        currency: dto.currency ?? 'BRL',
        images: dto.images ?? [],
        category: dto.category ?? null,
        attributes: dto.attributes ?? {},
        is_active: dto.is_active ?? true,
      })
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`create product failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to create product',
      );
    }
    return data as ProductCatalogItem;
  }

  async findAll(
    orgId: string,
    filters: ListProductsQueryDto,
  ): Promise<PaginatedResult<ProductCatalogItem>> {
    const page = filters.page;
    const limit = filters.limit;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let q = this.supabase.adminClient
      .from('products_catalog')
      .select('*', { count: 'exact' })
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (filters.category) q = q.eq('category', filters.category);
    if (filters.is_active !== undefined) q = q.eq('is_active', filters.is_active);

    if (filters.search && filters.search.trim().length > 0) {
      const escaped = filters.search.trim().replace(/[%_,()\\]/g, '');
      q = q.or(`name.ilike.%${escaped}%,sku.ilike.%${escaped}%`);
    }

    const { data, error, count } = await q;
    if (error) {
      this.logger.error(`findAll products failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    return {
      data: (data ?? []) as ProductCatalogItem[],
      page,
      limit,
      total: count ?? 0,
    };
  }

  async findById(orgId: string, id: string): Promise<ProductCatalogItem> {
    const { data, error } = await this.supabase.adminClient
      .from('products_catalog')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', id)
      .maybeSingle();

    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Product ${id} not found`);
    return data as ProductCatalogItem;
  }

  async update(
    orgId: string,
    id: string,
    dto: UpdateProductDto,
  ): Promise<ProductCatalogItem> {
    await this.findById(orgId, id);
    const { data, error } = await this.supabase.adminClient
      .from('products_catalog')
      .update(dto)
      .eq('org_id', orgId)
      .eq('id', id)
      .select('*')
      .single();

    if (error || !data) {
      this.logger.error(`update product failed: ${error?.message}`);
      throw new InternalServerErrorException(
        error?.message ?? 'Failed to update product',
      );
    }
    return data as ProductCatalogItem;
  }

  async delete(orgId: string, id: string): Promise<void> {
    await this.findById(orgId, id);
    const { error } = await this.supabase.adminClient
      .from('products_catalog')
      .delete()
      .eq('org_id', orgId)
      .eq('id', id);

    if (error) {
      this.logger.error(`delete product failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }
  }
}
