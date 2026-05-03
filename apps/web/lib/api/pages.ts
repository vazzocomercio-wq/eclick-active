import type {
  AiPageImprovement,
  Page,
  PageBlock,
  PageGlobalStyles,
  PageSEO,
  PageSettings,
  PageStatus,
  PageType,
  StoreOrder,
  StoreProduct,
  StoreProductVariant,
  PaymentStatus,
  FulfillmentStatus,
} from '@eclick-active/shared';
import { api } from './client';

export interface CreatePageInput {
  name: string;
  slug?: string;
  page_type?: PageType;
  blocks?: PageBlock[];
  global_styles?: PageGlobalStyles;
  seo?: PageSEO;
  settings?: PageSettings;
  template_id?: string;
  ai_generated?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdatePageInput {
  name?: string;
  slug?: string;
  blocks?: PageBlock[];
  global_styles?: PageGlobalStyles;
  seo?: PageSEO;
  settings?: PageSettings;
  status?: PageStatus;
  custom_domain?: string;
}

export interface GeneratePageInput {
  description: string;
  page_type: PageType;
  use_catalog_products?: boolean;
  include_form?: boolean;
  include_whatsapp?: boolean;
  available_form_id?: string;
}

export interface CreateProductInput {
  name: string;
  description?: string;
  price: number;
  compare_at_price?: number;
  currency?: string;
  images?: string[];
  variants?: StoreProductVariant[];
  category?: string;
  sku?: string;
  stock_quantity?: number;
  is_active?: boolean;
  catalog_product_id?: string;
}

export interface UpdateProductInput extends Partial<CreateProductInput> {
  position?: number;
}

export interface PageAnalytics {
  total_visits: number;
  unique_visitors: number;
  form_submissions: number;
  orders: number;
  revenue: number;
  conversion_rate: number;
  by_day: { date: string; visits: number; conversions: number }[];
  by_device: { device: string; count: number }[];
  by_source: { source: string; count: number }[];
  by_utm: {
    utm_source: string;
    utm_campaign: string;
    visits: number;
    conversions: number;
  }[];
  avg_scroll_depth: number;
  avg_duration_seconds: number;
}

export interface OrdersAnalytics {
  total_revenue: number;
  total_orders: number;
  avg_order_value: number;
  paid_orders: number;
  pending_orders: number;
  by_day: { date: string; revenue: number; orders: number }[];
  top_products: {
    product_id: string;
    name: string;
    quantity: number;
    revenue: number;
  }[];
  by_payment_status: { status: PaymentStatus; count: number }[];
}

export const pagesApi = {
  list(
    options: { page_type?: PageType; status?: PageStatus } = {},
    signal?: AbortSignal,
  ): Promise<Page[]> {
    return api.get<Page[]>('/pages', {
      query: {
        ...(options.page_type ? { page_type: options.page_type } : {}),
        ...(options.status ? { status: options.status } : {}),
      },
      signal,
    });
  },
  get(id: string, signal?: AbortSignal): Promise<Page> {
    return api.get<Page>(`/pages/${id}`, { signal });
  },
  create(input: CreatePageInput): Promise<Page> {
    return api.post<Page>('/pages', input);
  },
  update(id: string, input: UpdatePageInput): Promise<Page> {
    return api.patch<Page>(`/pages/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/pages/${id}`);
  },
  publish(id: string): Promise<Page> {
    return api.post<Page>(`/pages/${id}/publish`);
  },
  unpublish(id: string): Promise<Page> {
    return api.post<Page>(`/pages/${id}/unpublish`);
  },
  duplicate(id: string): Promise<Page> {
    return api.post<Page>(`/pages/${id}/duplicate`);
  },

  // AI
  generate(input: GeneratePageInput): Promise<Page> {
    return api.post<Page>('/pages/generate', input);
  },
  generateBlock(
    pageId: string,
    description: string,
    blockType?: string,
  ): Promise<PageBlock> {
    return api.post<PageBlock>(`/pages/${pageId}/blocks/generate`, {
      description,
      ...(blockType ? { block_type: blockType } : {}),
    });
  },
  rewriteBlock(pageId: string, blockId: string, instruction: string): Promise<Page> {
    return api.post<Page>(`/pages/${pageId}/blocks/${blockId}/rewrite`, {
      instruction,
    });
  },
  suggestImprovements(pageId: string): Promise<AiPageImprovement[]> {
    return api.post<AiPageImprovement[]>(`/pages/${pageId}/suggest-improvements`);
  },

  analytics(pageId: string, days = 30, signal?: AbortSignal): Promise<PageAnalytics> {
    return api.get<PageAnalytics>(`/pages/${pageId}/analytics`, {
      query: { days },
      signal,
    });
  },

  // Products
  listProducts(pageId: string, signal?: AbortSignal): Promise<StoreProduct[]> {
    return api.get<StoreProduct[]>(`/pages/${pageId}/products`, { signal });
  },
  createProduct(pageId: string, input: CreateProductInput): Promise<StoreProduct> {
    return api.post<StoreProduct>(`/pages/${pageId}/products`, input);
  },
  updateProduct(
    pageId: string,
    productId: string,
    input: UpdateProductInput,
  ): Promise<StoreProduct> {
    return api.patch<StoreProduct>(`/pages/${pageId}/products/${productId}`, input);
  },
  removeProduct(pageId: string, productId: string): Promise<void> {
    return api.delete<void>(`/pages/${pageId}/products/${productId}`);
  },
  importCatalog(pageId: string, catalogProductIds: string[]): Promise<StoreProduct[]> {
    return api.post<StoreProduct[]>(`/pages/${pageId}/products/import-catalog`, {
      catalog_product_ids: catalogProductIds,
    });
  },
  reorderProducts(pageId: string, ids: string[]): Promise<{ ok: true }> {
    return api.post<{ ok: true }>(`/pages/${pageId}/products/reorder`, { ids });
  },

  // Orders
  listOrders(
    pageId: string,
    filters: {
      payment_status?: PaymentStatus;
      fulfillment_status?: FulfillmentStatus;
      page?: number;
      limit?: number;
    } = {},
    signal?: AbortSignal,
  ): Promise<{ data: StoreOrder[]; total: number }> {
    return api.get<{ data: StoreOrder[]; total: number }>(`/pages/${pageId}/orders`, {
      query: {
        ...(filters.payment_status ? { payment_status: filters.payment_status } : {}),
        ...(filters.fulfillment_status
          ? { fulfillment_status: filters.fulfillment_status }
          : {}),
        ...(filters.page !== undefined ? { page: filters.page } : {}),
        ...(filters.limit !== undefined ? { limit: filters.limit } : {}),
      },
      signal,
    });
  },
  getOrder(pageId: string, orderId: string, signal?: AbortSignal): Promise<StoreOrder> {
    return api.get<StoreOrder>(`/pages/${pageId}/orders/${orderId}`, { signal });
  },
  updateOrder(
    pageId: string,
    orderId: string,
    input: {
      payment_status?: PaymentStatus;
      fulfillment_status?: FulfillmentStatus;
      notes?: string;
    },
  ): Promise<StoreOrder> {
    return api.patch<StoreOrder>(`/pages/${pageId}/orders/${orderId}`, input);
  },
  ordersAnalytics(pageId: string, days = 30, signal?: AbortSignal): Promise<OrdersAnalytics> {
    return api.get<OrdersAnalytics>(`/pages/${pageId}/orders-analytics`, {
      query: { days },
      signal,
    });
  },
};
