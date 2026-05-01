-- ============================================================
-- e-Click Active — Migration 007: Knowledge semantic search RPC
-- Schema: active
-- Date: 2026-05-01
-- Description: RPC function `search_knowledge_semantic` que recebe
--              um embedding (vector(1536)) + org_id e retorna os
--              documentos mais similares via cosine distance.
--              Usada pela IA pra buscar contexto antes de responder.
-- ============================================================

-- IMPORTANT: parameter type vector(1536) requires pgvector extension
-- (já criado em 001_foundation_schema.sql via CREATE EXTENSION pgvector).

CREATE OR REPLACE FUNCTION active.search_knowledge_semantic(
  p_org_id     uuid,
  p_embedding  vector(1536),
  p_limit      int DEFAULT 5,
  p_threshold  float DEFAULT 0.0
)
RETURNS TABLE (
  id          uuid,
  title       text,
  category    text,
  content     text,
  tokens      int,
  metadata    jsonb,
  similarity  float
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    kd.id,
    kd.title,
    kd.category,
    kd.content,
    kd.tokens,
    kd.metadata,
    -- cosine_distance retorna 0..2; convertemos pra similarity 1..-1.
    -- "1 - distance" é a convenção mais usada (1 = idêntico, 0 = ortogonal).
    (1 - (kd.embedding <=> p_embedding))::float AS similarity
  FROM active.knowledge_documents kd
  WHERE kd.org_id = p_org_id
    AND kd.is_active = true
    AND kd.embedding IS NOT NULL
    AND (1 - (kd.embedding <=> p_embedding)) >= p_threshold
  ORDER BY kd.embedding <=> p_embedding ASC
  LIMIT GREATEST(1, LEAST(p_limit, 50));
$$;

-- Grant execute pra clientes autenticados (RLS ainda aplicada via WHERE org_id).
GRANT EXECUTE ON FUNCTION active.search_knowledge_semantic(uuid, vector(1536), int, float) TO authenticated;
GRANT EXECUTE ON FUNCTION active.search_knowledge_semantic(uuid, vector(1536), int, float) TO service_role;

COMMENT ON FUNCTION active.search_knowledge_semantic IS
  'Busca semântica em knowledge_documents via cosine distance no embedding. Usa idx_knowledge_docs_embedding (ivfflat). Retorna até p_limit registros (max 50) ordenados por similaridade decrescente. Threshold padrão 0.0 (todos os ativos).';

COMMENT ON SCHEMA active IS
  'e-Click Active CRM (migrations 001-007 aplicadas — Knowledge semantic search RPC adicionada)';
