-- ============================================================
-- 019: AI interactions — feedback colunas explícitas + index
-- ============================================================
-- Antes: feedback ficava em metadata.feedback (jsonb) — funcional mas
-- caro de query pra analytics ("WHERE metadata->>'feedback' = 'positive'"
-- não usa index e força full scan).
--
-- Agora: colunas explícitas indexadas. submitInteractionFeedback escreve
-- nas duas formas (column + metadata) durante transição — eventualmente
-- a leitura migra pras columns e o jsonb fica como backup.
-- ============================================================

ALTER TABLE active.ai_interactions
  ADD COLUMN IF NOT EXISTS feedback text
    CHECK (feedback IN ('positive', 'negative'));

ALTER TABLE active.ai_interactions
  ADD COLUMN IF NOT EXISTS feedback_comment text;

ALTER TABLE active.ai_interactions
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;

-- Index pra agregar feedbacks por org/período no relatório
CREATE INDEX IF NOT EXISTS idx_ai_interactions_feedback
  ON active.ai_interactions (org_id, feedback, feedback_at DESC)
  WHERE feedback IS NOT NULL;
