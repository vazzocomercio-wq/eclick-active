-- ═══════════════════════════════════════════════════
-- 068 — Onda 4 / A3: SaaS↔Active Automation Bridge
-- Tabela de execuções (notify + cart_recovery + broadcast)
-- chamadas server-to-server pelo motor do SaaS.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.automation_executions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- Origem (SaaS automation action ID, opcional)
  source_action_id uuid,
  source_system    text NOT NULL DEFAULT 'saas_automation',

  -- Tipo de execução
  execution_type   text NOT NULL CHECK (execution_type IN (
    'whatsapp_notify_lojista',
    'cart_recovery_send',
    'whatsapp_broadcast'
  )),

  -- Severidade — usada pra agrupar digest (notify_lojista)
  severity        text CHECK (severity IS NULL OR severity IN (
    'critical', 'high', 'medium', 'low', 'opportunity'
  )),

  -- Dados da execução
  target_ref      text,          -- cart_id, customer_id, etc
  payload         jsonb NOT NULL DEFAULT '{}',
  result          jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'failed', 'skipped'
  )),
  error_message   text,
  /** Quando o digest worker juntou esta linha numa mensagem consolidada. */
  digest_id       uuid,

  created_at      timestamptz NOT NULL DEFAULT now(),
  executed_at     timestamptz
);

CREATE INDEX idx_auto_exec_org
  ON active.automation_executions(org_id, created_at DESC);
CREATE INDEX idx_auto_exec_status
  ON active.automation_executions(status)
  WHERE status = 'pending';
CREATE INDEX idx_auto_exec_source
  ON active.automation_executions(source_action_id)
  WHERE source_action_id IS NOT NULL;
CREATE INDEX idx_auto_exec_severity
  ON active.automation_executions(org_id, severity, created_at)
  WHERE status = 'pending' AND execution_type = 'whatsapp_notify_lojista';

ALTER TABLE active.automation_executions ENABLE ROW LEVEL SECURITY;

-- Apenas members da org leem; bridge usa service_role pra writes
CREATE POLICY auto_exec_select ON active.automation_executions
  FOR SELECT TO authenticated
  USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE ON active.automation_executions
  TO authenticated, service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.automation_executions;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

COMMENT ON TABLE active.automation_executions IS
  'Log de execuções disparadas pelo bridge SaaS↔Active. Cada row é uma mensagem ou ação executada (ou pendente em digest).';
COMMENT ON COLUMN active.automation_executions.source_action_id IS
  'ID da row em public.store_automation_actions (SaaS) — FK lógica cross-project.';
COMMENT ON COLUMN active.automation_executions.severity IS
  'Severidade do alerta. critical/high → envio imediato. medium → digest 4h. low/opportunity → digest diário.';
