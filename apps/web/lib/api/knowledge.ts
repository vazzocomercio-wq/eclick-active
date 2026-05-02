import type {
  KnowledgeCategory,
  KnowledgeDocument,
  KnowledgeLiveSource,
  ProductCatalogItem,
} from '@eclick-active/shared';
import { api } from './client';

export type FileType = 'pdf' | 'excel' | 'csv' | 'word' | 'text';

export interface FileUploadPreview {
  filename: string;
  file_type: FileType;
  file_size: number;
  content: string;
  char_count: number;
  token_estimate: number;
  truncated: boolean;
  pages_count?: number;
  sheets?: Array<{ name: string; content: string; rows: number }>;
}

export interface ConfirmFileUploadInput {
  filename: string;
  title: string;
  content: string;
  category?: KnowledgeCategory;
  file_type?: FileType;
  file_size?: number;
  pages_count?: number;
  selected_sheets?: Array<{ name: string; content: string; rows?: number }>;
}

export interface CreateLiveSourceInput {
  name: string;
  url: string;
  description?: string;
  source_type?: 'webpage' | 'api_endpoint' | 'rss_feed';
  cache_ttl_minutes?: number;
  is_active?: boolean;
}

export interface UpdateLiveSourceInput {
  name?: string;
  url?: string;
  description?: string;
  source_type?: 'webpage' | 'api_endpoint' | 'rss_feed';
  cache_ttl_minutes?: number;
  is_active?: boolean;
}

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

export interface UrlPreview {
  title: string;
  content: string;
  url: string;
  char_count: number;
  token_estimate: number;
  truncated: boolean;
}

export interface UrlBatchPreview {
  url: string;
  ok: boolean;
  title?: string;
  content?: string;
  char_count?: number;
  token_estimate?: number;
  truncated?: boolean;
  error?: string;
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

  // URL Import
  previewUrl(url: string, category?: KnowledgeCategory): Promise<UrlPreview> {
    return api.post<UrlPreview>('/knowledge/import-url', {
      url,
      ...(category ? { category } : {}),
    });
  },
  confirmUrlImport(input: {
    url: string;
    title: string;
    content: string;
    category?: KnowledgeCategory;
  }): Promise<KnowledgeDocumentListItem> {
    return api.post<KnowledgeDocumentListItem>('/knowledge/import-url/confirm', input);
  },
  batchPreviewUrls(urls: string[], category?: KnowledgeCategory): Promise<UrlBatchPreview[]> {
    return api.post<UrlBatchPreview[]>('/knowledge/import-url/batch', {
      urls,
      ...(category ? { category } : {}),
    });
  },
  batchConfirmUrls(input: {
    items: Array<{ url: string; title: string; content: string }>;
    category?: KnowledgeCategory;
  }): Promise<KnowledgeDocumentListItem[]> {
    return api.post<KnowledgeDocumentListItem[]>('/knowledge/import-url/batch/confirm', input);
  },
  refreshUrlDocument(id: string): Promise<{ updated: boolean; document: KnowledgeDocumentListItem }> {
    return api.post<{ updated: boolean; document: KnowledgeDocumentListItem }>(`/knowledge/${id}/refresh`);
  },

  // File upload (Feature A)
  async uploadFile(file: File): Promise<FileUploadPreview> {
    const fd = new FormData();
    fd.append('file', file);
    return api.post<FileUploadPreview>('/knowledge/upload', fd);
  },
  confirmFileUpload(input: ConfirmFileUploadInput): Promise<KnowledgeDocumentListItem[]> {
    return api.post<KnowledgeDocumentListItem[]>('/knowledge/upload/confirm', input);
  },

  // Live sources (Feature B)
  listLiveSources(signal?: AbortSignal): Promise<KnowledgeLiveSource[]> {
    return api.get<KnowledgeLiveSource[]>('/knowledge/live-sources', { signal });
  },
  createLiveSource(input: CreateLiveSourceInput): Promise<KnowledgeLiveSource> {
    return api.post<KnowledgeLiveSource>('/knowledge/live-sources', input);
  },
  updateLiveSource(id: string, input: UpdateLiveSourceInput): Promise<KnowledgeLiveSource> {
    return api.patch<KnowledgeLiveSource>(`/knowledge/live-sources/${id}`, input);
  },
  deleteLiveSource(id: string): Promise<void> {
    return api.delete<void>(`/knowledge/live-sources/${id}`);
  },
  testLiveSource(id: string): Promise<{ ok: boolean; content?: string; char_count?: number; error?: string }> {
    return api.post<{ ok: boolean; content?: string; char_count?: number; error?: string }>(
      `/knowledge/live-sources/${id}/test`,
    );
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
