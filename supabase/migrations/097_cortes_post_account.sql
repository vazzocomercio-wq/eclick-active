-- ═══════════════════════════════════════════════════
-- 097: Studio de Cortes — escolha de conta + rede por corte (multi-conta)
--
-- account_id já existe em clip_posts (id da credencial social escolhida).
-- Falta o flag de "publicar nesta rede" por plataforma.
-- ═══════════════════════════════════════════════════

ALTER TABLE active.clip_posts
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
