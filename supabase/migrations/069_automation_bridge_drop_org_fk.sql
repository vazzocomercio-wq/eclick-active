-- ═══════════════════════════════════════════════════
-- 069 — Onda 4 / A3: drop FK física org_id do bridge
--
-- `automation_executions.org_id` é uma referência LÓGICA cross-project
-- (Supabase Auth compartilhado entre SaaS e Active). O SaaS dispara
-- inserts usando seu próprio `organization_id` (de `public.organizations`
-- do projeto SaaS), que não bate com nenhuma row em `active.organizations`.
--
-- A constraint física quebrava todos os inserts vindos do bridge.
-- Removemos a constraint mas mantemos o índice (`idx_auto_exec_org`)
-- pra performance de query.
-- ═══════════════════════════════════════════════════

ALTER TABLE active.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_org_id_fkey;

COMMENT ON COLUMN active.automation_executions.org_id IS
  'Referência LÓGICA cross-project pro organization_id da org no SaaS. NÃO tem FK física pra active.organizations.';
