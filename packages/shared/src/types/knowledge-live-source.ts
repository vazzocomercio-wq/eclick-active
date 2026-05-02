import type { ISODateString, UUID } from './common';

/**
 * Fonte "live" de conhecimento — URLs cadastradas que a IA consulta em tempo
 * real quando precisa de informação atualizada (ex: estoque, preços do dia).
 *
 * Diferente do source_type='url' em knowledge_documents (que salva uma cópia
 * estática), aqui o conteúdo é fetchado on-demand e cacheado em memória por
 * `cache_ttl_minutes`.
 *
 * Tabela: active.knowledge_live_sources
 */
export interface KnowledgeLiveSource {
  id: UUID;
  org_id: UUID;
  name: string;
  url: string;
  /** Descrição curta usada pela IA pra decidir QUANDO consultar essa fonte. */
  description: string | null;
  source_type: 'webpage' | 'api_endpoint' | 'rss_feed';
  is_active: boolean;
  /** TTL do cache em memória — entre 5 e 1440 (24h). */
  cache_ttl_minutes: number;
  last_fetched_at: ISODateString | null;
  /** Hash SHA-256 do último content fetchado (pra detectar mudanças). */
  last_content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: ISODateString;
  updated_at: ISODateString;
}
