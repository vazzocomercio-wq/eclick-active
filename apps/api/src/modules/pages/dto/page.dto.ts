import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import type {
  AiPageGenerationInput,
  CreateOrderPayload,
  PageBlock,
  PageGlobalStyles,
  PageSEO,
  PageSettings,
  PageStatus,
  PageType,
  StoreProductVariant,
} from '@eclick-active/shared';

const PAGE_TYPES: PageType[] = [
  'landing',
  'store',
  'booking',
  'link_in_bio',
  'sales_page',
  'thank_you',
];

const PAGE_STATUSES: PageStatus[] = ['draft', 'published', 'paused', 'archived'];

export class CreatePageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/, { message: 'slug deve conter só letras minúsculas, números e hífen' })
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsIn(PAGE_TYPES)
  page_type?: PageType;

  @IsOptional()
  @IsArray()
  blocks?: PageBlock[];

  @IsOptional()
  @IsObject()
  global_styles?: PageGlobalStyles;

  @IsOptional()
  @IsObject()
  seo?: PageSEO;

  @IsOptional()
  @IsObject()
  settings?: PageSettings;

  @IsOptional()
  @IsString()
  template_id?: string;

  @IsOptional()
  @IsBoolean()
  ai_generated?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, unknown>;
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]+$/)
  @MaxLength(80)
  slug?: string;

  @IsOptional()
  @IsArray()
  blocks?: PageBlock[];

  @IsOptional()
  @IsObject()
  global_styles?: PageGlobalStyles;

  @IsOptional()
  @IsObject()
  seo?: PageSEO;

  @IsOptional()
  @IsObject()
  settings?: PageSettings;

  @IsOptional()
  @IsIn(PAGE_STATUSES)
  status?: PageStatus;

  @IsOptional()
  @IsString()
  custom_domain?: string;
}

// ────────────────────────────────────────────────────────────
// AI generation
// ────────────────────────────────────────────────────────────

export class GeneratePageDto implements AiPageGenerationInput {
  @IsString()
  @MinLength(15)
  @MaxLength(2000)
  description!: string;

  @IsIn(PAGE_TYPES)
  page_type!: PageType;

  @IsOptional()
  @IsBoolean()
  use_catalog_products?: boolean;

  @IsOptional()
  @IsBoolean()
  include_form?: boolean;

  @IsOptional()
  @IsBoolean()
  include_whatsapp?: boolean;

  @IsOptional()
  @IsString()
  available_form_id?: string;
}

export class GenerateBlockDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  description!: string;

  @IsOptional()
  @IsString()
  block_type?: string;
}

export class RewriteBlockDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  instruction!: string;
}

// ────────────────────────────────────────────────────────────
// Store products
// ────────────────────────────────────────────────────────────

export class CreateStoreProductDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @Type(() => Number)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  compare_at_price?: number;

  @IsOptional()
  @IsString()
  currency?: string;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsArray()
  variants?: StoreProductVariant[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  stock_quantity?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  catalog_product_id?: string;
}

export class UpdateStoreProductDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @Type(() => Number)
  compare_at_price?: number;

  @IsOptional()
  @IsArray()
  images?: string[];

  @IsOptional()
  @IsArray()
  variants?: StoreProductVariant[];

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  sku?: string;

  @IsOptional()
  @Type(() => Number)
  stock_quantity?: number;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @Type(() => Number)
  position?: number;
}

export class ImportCatalogDto {
  @IsArray()
  @IsString({ each: true })
  catalog_product_ids!: string[];
}

// ────────────────────────────────────────────────────────────
// Orders
// ────────────────────────────────────────────────────────────

export class CreateOrderDto implements CreateOrderPayload {
  @IsArray()
  items!: { product_id: string; quantity: number; variant_label?: string }[];

  @IsString()
  @IsNotEmpty()
  customer_name!: string;

  @IsOptional()
  @IsString()
  customer_email?: string;

  @IsString()
  @IsNotEmpty()
  customer_phone!: string;

  @IsOptional()
  @IsObject()
  customer_address?: {
    cep?: string;
    street?: string;
    number?: string;
    complement?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  };

  @IsOptional()
  @IsIn(['whatsapp', 'pix'])
  payment_method?: 'whatsapp' | 'pix';

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsIn(['pending', 'paid', 'failed', 'refunded'])
  payment_status?: 'pending' | 'paid' | 'failed' | 'refunded';

  @IsOptional()
  @IsIn(['unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled'])
  fulfillment_status?:
    | 'unfulfilled'
    | 'processing'
    | 'shipped'
    | 'delivered'
    | 'cancelled';

  @IsOptional()
  @IsString()
  notes?: string;
}

// ────────────────────────────────────────────────────────────
// Visit tracking (público)
// ────────────────────────────────────────────────────────────

export class TrackVisitDto {
  @IsOptional()
  @IsString()
  visitor_id?: string;

  @IsOptional()
  @IsString()
  session_id?: string;

  @IsOptional()
  @IsString()
  referrer?: string;

  @IsOptional()
  @IsString()
  utm_source?: string;

  @IsOptional()
  @IsString()
  utm_medium?: string;

  @IsOptional()
  @IsString()
  utm_campaign?: string;

  @IsOptional()
  @IsString()
  utm_content?: string;

  @IsOptional()
  @IsString()
  utm_term?: string;

  @IsOptional()
  @IsIn(['desktop', 'mobile', 'tablet'])
  device?: 'desktop' | 'mobile' | 'tablet';

  @IsOptional()
  @IsString()
  browser?: string;

  @IsOptional()
  @Type(() => Number)
  duration_seconds?: number;

  @IsOptional()
  @Type(() => Number)
  scroll_depth_pct?: number;
}
