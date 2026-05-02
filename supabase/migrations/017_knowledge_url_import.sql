-- ============================================================
-- 017: Knowledge documents — source_type + URL import metadata
-- ============================================================
-- Adiciona campos pra rastrear origem do documento (manual/url/etc.),
-- a URL fonte (quando source_type='url') e o timestamp do último sync.
--
-- Backward-compat: source_type default 'manual', então docs antigos
-- ficam marcados como manuais.
-- ============================================================

ALTER TABLE active.knowledge_documents
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'url', 'integration', 'auto'));

ALTER TABLE active.knowledge_documents
  ADD COLUMN IF NOT EXISTS source_url text;

ALTER TABLE active.knowledge_documents
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

ALTER TABLE active.knowledge_documents
  ADD COLUMN IF NOT EXISTS auto_sync boolean NOT NULL DEFAULT false;

-- Índice pro filtro "Por fonte" no frontend
CREATE INDEX IF NOT EXISTS idx_knowledge_source_type
  ON active.knowledge_documents (org_id, source_type)
  WHERE is_active = true;

-- Lookup por URL pra evitar duplicatas em re-import
CREATE INDEX IF NOT EXISTS idx_knowledge_source_url
  ON active.knowledge_documents (org_id, source_url)
  WHERE source_url IS NOT NULL;
