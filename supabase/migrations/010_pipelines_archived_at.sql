-- ============================================================
-- 010: pipelines.archived_at
-- ============================================================
-- Permite arquivar pipelines (esconder do board e do selector) sem
-- apagar dados — relatórios continuam funcionando. Pipelines arquivados
-- são listáveis em /funis/configuracoes com badge "Arquivado".
-- ============================================================

ALTER TABLE active.pipelines
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

-- Index parcial pra queries do tipo "pipelines ativos da org" — caminho
-- crítico do board e do selector, ignora os arquivados sem custo extra.
CREATE INDEX IF NOT EXISTS idx_pipelines_active
  ON active.pipelines (org_id, is_default DESC, name)
  WHERE archived_at IS NULL;
