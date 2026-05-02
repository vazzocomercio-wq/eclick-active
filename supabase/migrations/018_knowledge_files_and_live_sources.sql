-- ============================================================
-- 018: Knowledge — file uploads + live sources (consulta em tempo real)
-- ============================================================
-- Feature A: aceitar 'file' no source_type pra arquivos uploadados (PDF,
--            Excel, CSV, Word, TXT) — apenas estende o CHECK constraint.
-- Feature B: nova tabela knowledge_live_sources — URLs cadastradas pra
--            consulta em tempo real (cache em memória, sem persistir
--            content estaticamente como na importação).
-- ============================================================

-- 1. Estende source_type pra incluir 'file'
ALTER TABLE active.knowledge_documents
  DROP CONSTRAINT IF EXISTS knowledge_documents_source_type_check;

ALTER TABLE active.knowledge_documents
  ADD CONSTRAINT knowledge_documents_source_type_check
  CHECK (source_type IN ('manual', 'url', 'file', 'integration', 'auto'));

-- 2. Tabela de fontes live (consulta em tempo real)
CREATE TABLE IF NOT EXISTS active.knowledge_live_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  description text,
  source_type text NOT NULL DEFAULT 'webpage'
    CHECK (source_type IN ('webpage', 'api_endpoint', 'rss_feed')),
  is_active boolean NOT NULL DEFAULT true,
  cache_ttl_minutes integer NOT NULL DEFAULT 60 CHECK (cache_ttl_minutes >= 5 AND cache_ttl_minutes <= 1440),
  last_fetched_at timestamptz,
  last_content_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- RLS: org_isolation idêntico aos outros recursos da Active
ALTER TABLE active.knowledge_live_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.knowledge_live_sources;
CREATE POLICY "org_isolation" ON active.knowledge_live_sources
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE INDEX IF NOT EXISTS idx_live_sources_org
  ON active.knowledge_live_sources (org_id, is_active)
  WHERE is_active = true;

-- Trigger pra atualizar updated_at automaticamente (se a função genérica existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_live_sources_updated_at ON active.knowledge_live_sources;
    EXECUTE 'CREATE TRIGGER trg_live_sources_updated_at BEFORE UPDATE ON active.knowledge_live_sources FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;
