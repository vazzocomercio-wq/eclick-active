-- ============================================================
-- 050: alert_deliveries — entregas de alertas (1 row = 1 envio)
-- ============================================================
-- Bloco H do Active Intelligence: cada delivery é um envio único pra
-- 1 manager. Pra immediate, 1 signal = N deliveries (N managers da rule).
-- Pra digest, N signals → 1 delivery por manager (signals_batch contém
-- todos os IDs).
--
-- status:
--   pending — criado, aguardando dispatch worker
--   queued  — worker pegou, evita double-dispatch concorrente
--   sent    — enviado com sucesso (channel_message_id retornado)
--   failed  — falhou após retries (error_message)
--   acked   — manager confirmou recebimento (POST /:id/ack ou reply)
--
-- retry_count + last_attempt_at: pra backoff exponencial (5min, 15min, 1h)
-- ============================================================

CREATE TABLE IF NOT EXISTS active.alert_deliveries (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  manager_id           uuid NOT NULL REFERENCES active.alert_managers(id) ON DELETE CASCADE,
  /** Signal individual quando delivery_mode='immediate'. NULL pra digest. */
  signal_id            uuid REFERENCES active.ad_signals(id) ON DELETE SET NULL,
  /** IDs dos signals consolidados no digest. Vazio em immediate. */
  signals_batch        uuid[] NOT NULL DEFAULT '{}'::uuid[],
  delivery_mode        text NOT NULL
    CHECK (delivery_mode IN ('immediate', 'digest_8h', 'digest_14h', 'digest_18h', 'weekly')),
  -- Texto efetivamente enviado. NULL quando delivery está "deferred"
  -- (digest_X/weekly aguardando o slot disparar pra consolidar).
  -- AlertEngine processDigestSlot popula com texto consolidado e
  -- cria a delivery final com message_text preenchido.
  message_text         text,
  /** Canal usado pra enviar (pode ser default da org ou custom do manager). */
  channel_id           uuid REFERENCES active.channels(id) ON DELETE SET NULL,
  /** ID que o Baileys/provider retornou (pra rastrear delivery, ack, etc.) */
  channel_message_id   text,
  status               text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'queued', 'sent', 'failed', 'acked')),
  /** Quem narrou — 'llm' ou 'template'. Preserva audit do path Camada 4 vs cru. */
  narrator             text NOT NULL DEFAULT 'template'
    CHECK (narrator IN ('template', 'llm')),
  retry_count          int NOT NULL DEFAULT 0,
  error_message        text,
  generated_at         timestamptz NOT NULL DEFAULT now(),
  last_attempt_at      timestamptz,
  sent_at              timestamptz,
  ack_at               timestamptz,
  acked_by             uuid
);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_org_status
  ON active.alert_deliveries (org_id, status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_pending
  ON active.alert_deliveries (status, last_attempt_at NULLS FIRST)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_manager
  ON active.alert_deliveries (manager_id, generated_at DESC);

ALTER TABLE active.alert_deliveries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.alert_deliveries;
CREATE POLICY "org_isolation" ON active.alert_deliveries
  FOR ALL USING (org_id = active.get_user_org_id());

COMMENT ON TABLE active.alert_deliveries IS
  '1 row = 1 envio pra 1 manager. immediate=signal_id; digest/weekly=signals_batch[].';
