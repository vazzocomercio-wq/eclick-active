-- ═══════════════════════════════════════════════════════════════════════
-- 110 — AI phase 2: broadcast/cart recovery assíncrono + retomada
--
-- Contexto: sendBroadcast/triggerCartRecovery rodavam o loop rate-limited
-- DENTRO do request HTTP (1000 contatos × 3s ≈ 50min → proxy mata o request,
-- contatos não recebem, sem retomada). Agora lotes grandes processam em
-- background e um scheduler leve reprocessa execuções pendentes/órfãs pra
-- sobreviver a restart.
--
-- Este migration só adiciona infra de reivindicação idempotente:
--   1. status 'processing' (reivindicada por um worker)
--   2. claimed_by / claimed_at (quem reivindicou e quando — reclamar órfãs)
--   3. índice de retomada
--
-- Tudo idempotente / dupe-guarded. Nenhuma mudança de dado existente.
-- ═══════════════════════════════════════════════════════════════════════

SET search_path = active, public;

-- 1) Permite o novo status 'processing' no CHECK existente.
--    Drop name-agnostic: acha qualquer CHECK do 'status' e remove antes de
--    recriar — evita ficar com dois checks conflitantes se o nome divergir.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class cls ON cls.oid = con.conrelid
    JOIN pg_namespace ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = 'active'
      AND cls.relname = 'automation_executions'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format(
      'ALTER TABLE active.automation_executions DROP CONSTRAINT %I',
      c.conname
    );
  END LOOP;
END $$;

ALTER TABLE active.automation_executions
  ADD CONSTRAINT automation_executions_status_check
  CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped'));

-- 2) Colunas de reivindicação (claim). Nullable — linhas antigas ficam NULL.
ALTER TABLE active.automation_executions
  ADD COLUMN IF NOT EXISTS claimed_by text;
ALTER TABLE active.automation_executions
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz;

-- 3) Índice pro scheduler de retomada varrer execuções ainda "abertas"
--    (pending ou processing órfã) por tipo/idade sem full scan.
CREATE INDEX IF NOT EXISTS idx_auto_exec_resume
  ON active.automation_executions (execution_type, status, created_at)
  WHERE status IN ('pending', 'processing');

COMMENT ON COLUMN active.automation_executions.claimed_by IS
  'Worker (LockService.holder) que reivindicou a execução pra envio. NULL = não reivindicada.';
COMMENT ON COLUMN active.automation_executions.claimed_at IS
  'Quando a execução foi reivindicada. O scheduler de retomada reclama linhas processing com claimed_at antigo (worker morto).';

-- GRANT explícito (idempotente) — mantém o bridge (service_role) e leitura
-- do lojista (authenticated via RLS) funcionando após o schema reload.
GRANT SELECT, INSERT, UPDATE ON active.automation_executions
  TO authenticated, service_role;

-- Recarrega o schema cache do PostgREST.
NOTIFY pgrst, 'reload schema';
