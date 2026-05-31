-- ═══════════════════════════════════════════════════
-- 096: Studio de Cortes Sprint 2 — publicação nativa
--
-- Campos de resultado de publicação por plataforma em clip_posts +
-- scopes concedidos na conexão Google (pra saber se youtube.upload existe).
-- ═══════════════════════════════════════════════════

ALTER TABLE active.clip_posts
  ADD COLUMN IF NOT EXISTS external_post_url text,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS error text,
  ADD COLUMN IF NOT EXISTS publish_attempts integer NOT NULL DEFAULT 0;

-- Worker de publicação procura posts "publicáveis" (ainda sem post externo).
CREATE INDEX IF NOT EXISTS idx_clip_posts_publishable
  ON active.clip_posts(status)
  WHERE external_post_id IS NULL;

-- Conexão Google passa a guardar os escopos concedidos (drive.file [+ youtube.upload]).
ALTER TABLE active.cortes_drive_connections
  ADD COLUMN IF NOT EXISTS scopes text[] NOT NULL DEFAULT '{}';
