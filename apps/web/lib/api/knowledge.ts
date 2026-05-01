import type {
  KnowledgeCategory,
  KnowledgeDocument,
  ProductCatalogItem,
} from '@eclick-active/shared';
import { api } from './client';

/** Lista enxuta — sem `embedding` (campo grande). */
export type KnowledgeDocumentListItem = Omit<KnowledgeDocument, 'embedding'>;

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  limit: number;
  total: number;
}

export interface ListDocumentsParams {
  page?: number;
  limit?: number;
  category?: KnowledgeCategory;
  is_active?: boolean;
  search?: string;
}

export interface CreateDocumentInput {
  title: string;
  category?: KnowledgeCategory;
  content: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface UpdateDocumentInput {
  title?: string;
  category?: KnowledgeCategory;
  content?: string;
  is_active?: boolean;
  metadata?: Record<string, unknown>;
}

export interface SemanticSearchHit {
  id: string;
  title: string;
  category: string;
  content: string;
  tokens: number | null;
  metadata: Record<string, unknown>;
  similarity: number;
}

export interface ListProductsParams {
  page?: number;
  limit?: number;
  category?: string;
  is_active?: boolean;
  search?: string;
}

export interface CreateProductInput {
  name: string;
  sku?: string;
  description?: string;
  price?: number;
  currency?: string;
  images?: string[];
  category?: string;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
}

export interface UpdateProductInput {
  name?: string;
  sku?: string;
  description?: string;
  price?: number;
  currency?: string;
  images?: string[];
  category?: string;
  attributes?: Record<string, unknown>;
  is_active?: boolean;
}

function docParams(p: ListDocumentsParams): Record<string, string | number | undefined> {
  return {
    page: p.page,
    limit: p.limit,
    category: p.category,
    is_active: p.is_active === undefined ? undefined : p.is_active ? 'true' : 'false',
    search: p.search,
  };
}

function productParams(p: ListProductsParams): Record<string, string | number | undefined> {
  return {
    page: p.page,
    limit: p.limit,
    category: p.category,
    is_active: p.is_active === undefined ? undefined : p.is_active ? 'true' : 'false',
    search: p.search,
  };
}

export const knowledgeApi = {
  // Documents
  list(params: ListDocumentsParams = {}, signal?: AbortSignal): Promise<PaginatedResult<KnowledgeDocumentListItem>> {
    return api.get<PaginatedResult<KnowledgeDocumentListItem>>('/knowledge', {
      query: docParams(params),
      signal,
    });
  },
  get(id: string, signal?: AbortSignal): Promise<KnowledgeDocumentListItem> {
    return api.get<KnowledgeDocumentListItem>(`/knowledge/${id}`, { signal });
  },
  create(input: CreateDocumentInput): Promise<KnowledgeDocumentListItem> {
    return api.post<KnowledgeDocumentListItem>('/knowledge', input);
  },
  update(id: string, input: UpdateDocumentInput): Promise<KnowledgeDocumentListItem> {
    return api.patch<KnowledgeDocumentListItem>(`/knowledge/${id}`, input);
  },
  remove(id: string): Promise<void> {
    return api.delete<void>(`/knowledge/${id}`);
  },
  search(query: string, limit = 5): Promise<SemanticSearchHit[]> {
    return api.post<SemanticSearchHit[]>('/knowledge/search', { query, limit });
  },

  // Products
  listProducts(params: ListProductsParams = {}, signal?: AbortSignal): Promise<PaginatedResult<ProductCatalogItem>> {
    return api.get<PaginatedResult<ProductCatalogItem>>('/knowledge/products', {
      query: productParams(params),
      signal,
    });
  },
  getProduct(id: string, signal?: AbortSignal): Promise<ProductCatalogItem> {
    return api.get<ProductCatalogItem>(`/knowledge/products/${id}`, { signal });
  },
  createProduct(input: CreateProductInput): Promise<ProductCatalogItem> {
    return api.post<ProductCatalogItem>('/knowledge/products', input);
  },
  updateProduct(id: string, input: UpdateProductInput): Promise<ProductCatalogItem> {
    return api.patch<ProductCatalogItem>(`/knowledge/products/${id}`, input);
  },
  removeProduct(id: string): Promise<void> {
    return api.delete<void>(`/knowledge/products/${id}`);
  },
};
