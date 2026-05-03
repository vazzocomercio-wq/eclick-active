import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { StoreProduct } from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';
import {
  CreateStoreProductDto,
  ImportCatalogDto,
  UpdateStoreProductDto,
} from './dto/page.dto';

@Injectable()
export class StoreProductsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(orgId: string, pageId: string): Promise<StoreProduct[]> {
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .select('*')
      .eq('org_id', orgId)
      .eq('page_id', pageId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as StoreProduct[];
  }

  async listPublic(pageId: string): Promise<StoreProduct[]> {
    // Sem org_id check — usado no /p/:slug/products (público)
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .select('*')
      .eq('page_id', pageId)
      .eq('is_active', true)
      .order('position', { ascending: true });
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as StoreProduct[];
  }

  async create(
    orgId: string,
    pageId: string,
    dto: CreateStoreProductDto,
  ): Promise<StoreProduct> {
    const position = await this.nextPosition(pageId);
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .insert({
        org_id: orgId,
        page_id: pageId,
        catalog_product_id: dto.catalog_product_id ?? null,
        name: dto.name,
        description: dto.description ?? null,
        price: dto.price,
        compare_at_price: dto.compare_at_price ?? null,
        currency: dto.currency ?? 'BRL',
        images: dto.images ?? [],
        variants: dto.variants ?? [],
        category: dto.category ?? null,
        sku: dto.sku ?? null,
        stock_quantity: dto.stock_quantity ?? null,
        is_active: dto.is_active ?? true,
        position,
      })
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    return data as StoreProduct;
  }

  async update(
    orgId: string,
    pageId: string,
    productId: string,
    dto: UpdateStoreProductDto,
  ): Promise<StoreProduct> {
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(dto) as (keyof UpdateStoreProductDto)[]) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .update(patch)
      .eq('org_id', orgId)
      .eq('page_id', pageId)
      .eq('id', productId)
      .select('*')
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Product ${productId}`);
    return data as StoreProduct;
  }

  async remove(orgId: string, pageId: string, productId: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('store_products')
      .delete()
      .eq('org_id', orgId)
      .eq('page_id', pageId)
      .eq('id', productId);
    if (error) throw new InternalServerErrorException(error.message);
  }

  async findById(orgId: string, productId: string): Promise<StoreProduct> {
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .select('*')
      .eq('org_id', orgId)
      .eq('id', productId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    if (!data) throw new NotFoundException(`Product ${productId}`);
    return data as StoreProduct;
  }

  /** Importa produtos do products_catalog em lote pra loja. */
  async importFromCatalog(
    orgId: string,
    pageId: string,
    dto: ImportCatalogDto,
  ): Promise<StoreProduct[]> {
    if (dto.catalog_product_ids.length === 0) {
      throw new BadRequestException('catalog_product_ids vazio');
    }
    const { data: catalog, error: catErr } = await this.supabase.adminClient
      .from('products_catalog')
      .select('*')
      .eq('org_id', orgId)
      .in('id', dto.catalog_product_ids);
    if (catErr) throw new InternalServerErrorException(catErr.message);
    const cat =
      (catalog ?? []) as Array<{
        id: string;
        name: string;
        description: string | null;
        price: number | null;
        currency: string;
        images: string[];
        category: string | null;
        sku: string | null;
      }>;
    if (cat.length === 0) {
      throw new BadRequestException('Nenhum produto do catálogo encontrado');
    }
    let position = await this.nextPosition(pageId);
    const rows = cat.map((p) => ({
      org_id: orgId,
      page_id: pageId,
      catalog_product_id: p.id,
      name: p.name,
      description: p.description ?? null,
      price: p.price ?? 0,
      currency: p.currency ?? 'BRL',
      images: p.images ?? [],
      category: p.category ?? null,
      sku: p.sku ?? null,
      is_active: true,
      position: position++,
    }));
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .insert(rows)
      .select('*');
    if (error) throw new InternalServerErrorException(error.message);
    return (data ?? []) as StoreProduct[];
  }

  /** Re-ordena produtos com base num array de IDs em ordem. */
  async reorder(orgId: string, pageId: string, ids: string[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 1) {
      await this.supabase.adminClient
        .from('store_products')
        .update({ position: i })
        .eq('org_id', orgId)
        .eq('page_id', pageId)
        .eq('id', ids[i]);
    }
  }

  private async nextPosition(pageId: string): Promise<number> {
    const { data, error } = await this.supabase.adminClient
      .from('store_products')
      .select('position')
      .eq('page_id', pageId)
      .order('position', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return 0;
    return ((data[0] as { position: number }).position ?? 0) + 1;
  }
}
