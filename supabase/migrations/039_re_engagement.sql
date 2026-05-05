-- 039: Re-engagement de leads parados
--
-- Tabela `re_engagement_runs` registra cada tentativa do worker de
-- reativar uma conversa parada. Usada pra:
--   1. Evitar mandar duas vezes pra mesma conversa em curto prazo
--   2. Painel de follow-ups (UI lista runs recentes)
--   3. Métricas de eficácia (replied=true / replied=false)
--
-- Settings ficam em `organizations.settings.re_engagement`:
--   { enabled: bool, days_threshold: int, max_retries: int,
--     only_with_open_deal: bool, min_advance_days_between: int }
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS active.re_engagement_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES active.conversations(id) ON DELETE CASCADE,
  contact_id      uuid NOT NULL REFERENCES active.contacts(id) ON DELETE CASCADE,
  message_text    text NOT NULL,
  /** ID da mensagem outbound persistida em messages (se enviou). */
  message_id      uuid,
  /** ok | failed | skipped */
  status          text NOT NULL CHECK (status IN ('ok', 'failed', 'skipped')),
  /** Quando o lead respondeu após a re-tentativa (worker preenche em ciclo seguinte). */
  replied_at      timestamptz,
  error_message   text,
  /** Quantidade de dias desde a última atividade do lead na hora da tentativa. */
  days_since_last_activity int NOT NULL,
  /** Contador de tentativas pra essa conversa (1, 2, 3…) */
  retry_number    int NOT NULL DEFAULT 1,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reeng_org_created
  ON active.re_engagement_runs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reeng_conversation
  ON active.re_engagement_runs (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reeng_pending_reply
  ON active.re_engagement_runs (org_id, status, created_at DESC)
  WHERE status = 'ok' AND replied_at IS NULL;

ALTER TABLE active.re_engagement_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS reeng_select_own ON active.re_engagement_runs;
CREATE POLICY reeng_select_own ON active.re_engagement_runs
  FOR SELECT USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS reeng_modify_own ON active.re_engagement_runs;
CREATE POLICY reeng_modify_own ON active.re_engagement_runs
  FOR ALL USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

NOTIFY pgrst, 'reload schema';
