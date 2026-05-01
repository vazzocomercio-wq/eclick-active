-- ============================================================
-- e-Click Active — Migration 005: Realtime para deals + activities
-- Schema: active
-- Date: 2026-05-01
-- Description: Habilita Supabase Realtime nas tabelas active.deals
--              e active.deal_activities pra o Funil Vivo (Kanban
--              reativo) e timeline em tempo real do detalhe.
-- ============================================================

-- Adiciona à publication. Idempotente — re-rodar não dá erro.
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.deals;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'active.deals already in supabase_realtime, skipping';
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.deal_activities;
EXCEPTION
  WHEN duplicate_object THEN
    RAISE NOTICE 'active.deal_activities already in supabase_realtime, skipping';
END $$;

-- REPLICA IDENTITY FULL — sem isso, eventos UPDATE/DELETE só carregam
-- a primary key, e o Kanban precisa do payload completo (stage_id antigo,
-- position, valor, etc) pra animar a transição.
ALTER TABLE active.deals REPLICA IDENTITY FULL;
ALTER TABLE active.deal_activities REPLICA IDENTITY FULL;

COMMENT ON SCHEMA active IS 'e-Click Active CRM (migrations 001-005 aplicadas — Realtime em deals + activities)';
