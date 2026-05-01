-- ============================================================
-- e-Click Active — Migration 004: Enable Supabase Realtime
-- Schema: active
-- Date: 2026-05-01
-- Description: Adiciona conversations e messages à publication
--              `supabase_realtime` pra o frontend escutar INSERT/UPDATE
--              direto via Supabase Realtime client. Eventos custom
--              (ai:suggestion, etc.) vão pelo WebSocket gateway do api.
-- ============================================================

-- Adiciona as tabelas à publication. Idempotente quando o schema é fresh —
-- caso já exista, ALTER PUBLICATION ADD falha; usamos DO block pra ignorar
-- "duplicate object" e seguir.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.conversations;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'active.conversations already in supabase_realtime, skipping';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.messages;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'active.messages already in supabase_realtime, skipping';
END $$;

-- ── REPLICA IDENTITY FULL ──
-- Sem isso, eventos de UPDATE/DELETE só carregam a primary key — o
-- frontend não recebe os dados da row. Custo extra: WAL fica maior
-- (~1 row a mais por write). Pra esses dois é aceitável.
--
-- Em tabela particionada, ALTER ... REPLICA IDENTITY FULL no parent
-- propaga pras partições filhas (Postgres 13+).
ALTER TABLE active.conversations REPLICA IDENTITY FULL;
ALTER TABLE active.messages REPLICA IDENTITY FULL;

COMMENT ON SCHEMA active IS 'e-Click Active CRM (migrations 001-004 aplicadas — Realtime habilitado)';
