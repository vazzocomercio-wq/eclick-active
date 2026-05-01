-- ============================================================
-- e-Click Active — Migration 006: Copilot messages
-- Schema: active
-- Date: 2026-05-01
-- Description: Tabela particionada (mensal) de histórico do
--              Copiloto Comercial. Uma "conversa" do copiloto
--              por (org_id, user_id), com role + content + tool_calls.
--              Particionada por created_at como active.messages.
-- ============================================================

CREATE TABLE active.copilot_messages (
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  role        text NOT NULL CHECK (role IN ('user', 'assistant')),
  content     text NOT NULL,
  /** Array de tool_use blocks emitidos nesse turno (assistant) ou tool_results devolvidos (user). */
  tool_calls  jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Custo USD acumulado da chamada multi-turn que produziu essa resposta. */
  cost_usd    numeric(10, 6) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Particiona 12 meses adiante seguindo o mesmo padrão de active.messages
DO $$
DECLARE
  start_date date := '2026-05-01';
  partition_date date;
  partition_name text;
  next_date date;
BEGIN
  FOR i IN 0..11 LOOP
    partition_date := start_date + (i || ' months')::interval;
    next_date := partition_date + '1 month'::interval;
    partition_name := 'copilot_messages_' || to_char(partition_date, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE active.%I PARTITION OF active.copilot_messages
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_date,
      next_date
    );
  END LOOP;
END $$;

-- Default partition para inserts fora do range previsto.
CREATE TABLE active.copilot_messages_default PARTITION OF active.copilot_messages DEFAULT;

-- Index pra GET /copilot/history — pega histórico do user mais recente primeiro.
CREATE INDEX idx_copilot_messages_user_created
  ON active.copilot_messages (org_id, user_id, created_at DESC);

COMMENT ON TABLE active.copilot_messages IS
  'Histórico do Copiloto Comercial. Particionada mensalmente. role=user mensagens do agente, role=assistant respostas do modelo. tool_calls registra tool_use/tool_result blocks.';

COMMENT ON SCHEMA active IS
  'e-Click Active CRM (migrations 001-006 aplicadas — Copilot messages adicionadas)';
