import type { UUID, ISODateString } from './common';
import type { KnowledgeCategory } from '../enums';

/**
 * Documento da base de conhecimento. Indexado com pgvector pra busca semântica.
 * Tabela: active.knowledge_documents
 */
export interface KnowledgeDocument {
  id: UUID;
  org_id: UUID;
  title: string;
  category: KnowledgeCategory;
  /** Texto livre — markdown suportado */
  content: string;
  /**
   * Embedding gerado por OpenAI text-embedding-3-small (1536 dims).
   * Vem como `null` em queries normais (campo é grande); buscar explicitamente quando precisar.
   */
  embedding: number[] | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  /** Contagem de tokens do `content` (pra controle de custo) */
  tokens: number | null;
  /**
   * Origem do documento (Bloco URL Import). 'manual' = criado direto pelo
   * admin via form. 'url' = importado de uma página web. 'integration' =
   * sincronizado de sistema externo (futuro). 'auto' = gerado pela IA.
   */
  source_type: 'manual' | 'url' | 'integration' | 'auto';
  /** URL de origem (só pra source_type='url') */
  source_url: string | null;
  /** Última vez que o conteúdo foi re-fetchado (só pra source_type='url') */
  last_synced_at: ISODateString | null;
  /** Reservado pra sync periódico futuro (cron) */
  auto_sync: boolean;
  /** Bloco F: docs com priority_intents aparecem primeiro no RAG quando o intent bate */
  priority_intents: string[];
  created_by: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Catálogo de produtos da empresa (usado em propostas, campanhas, conversas).
 * Tabela: active.products_catalog
 */
export interface ProductCatalogItem {
  id: UUID;
  org_id: UUID;
  name: string;
  sku: string | null;
  description: string | null;
  price: number | null;
  currency: string;
  images: string[];
  category: string | null;
  /** Atributos livres (ex: { color: 'blue', size: 'M' }) */
  attributes: Record<string, unknown>;
  is_active: boolean;
  /** Vínculo com produto no e-Click SaaS (se aplicável) */
  saas_product_id: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}

/**
 * Template de resposta com tracking de performance.
 * Tabela: active.response_templates
 */
export interface ResponseTemplate {
  id: UUID;
  org_id: UUID;
  name: string;
  /** Texto com placeholders {{var}} */
  content: string;
  /** Categoria livre: greeting, objection, closing, follow_up, pricing, etc. */
  category: string | null;
  context_tags: string[];
  use_count: number;
  /** % de conversão observada quando este template é usado */
  conversion_rate: number | null;
  /** Nota 1.0–5.0 atribuída pela IA quando avalia respostas */
  avg_response_quality: number | null;
  ai_generated: boolean;
  created_by: UUID | null;
  created_at: ISODateString;
  updated_at: ISODateString;
}
