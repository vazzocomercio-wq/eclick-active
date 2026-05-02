-- ============================================================
-- 011: automations.stage_id + webhook_endpoints + webhook_deliveries
-- ============================================================
-- Bloco C do refactor:
--   1. Vincula automações a stages específicas (Funil Digital)
--   2. Tabelas pra webhooks de saída (CRM → URL externa)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. automations.stage_id (Funil Digital)
-- ────────────────────────────────────────────────────────────
-- Quando setado, a automação só dispara pra deals NESTE stage.
-- Quando NULL, é uma automação "global" (vale pra qualquer stage).
-- O service `checkTriggers` filtra: automations.stage_id IS NULL
-- OU automations.stage_id = deal.stage_id atual.

ALTER TABLE active.automations
  ADD COLUMN IF NOT EXISTS stage_id uuid
    REFERENCES active.pipeline_stages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_automations_stage
  ON active.automations (stage_id)
  WHERE stage_id IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- 2. webhook_endpoints — registro de URLs externas
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.webhook_endpoints (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  url             text NOT NULL,
  -- Lista de event_types que o endpoint quer receber. Lista vazia = nenhum.
  events          text[] NOT NULL DEFAULT '{}',
  -- Secret pra HMAC SHA-256 (header X-Webhook-Signature). Opcional.
  secret          text,
  is_active       boolean NOT NULL DEFAULT true,
  -- Contagem de falhas consecutivas. Se passar de 50, auto-desativa.
  failure_count   int NOT NULL DEFAULT 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org_active
  ON active.webhook_endpoints (org_id)
  WHERE is_active = true;

CREATE TRIGGER trg_webhook_endpoints_updated_at
  BEFORE UPDATE ON active.webhook_endpoints
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.webhook_endpoints ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_endpoints_select
  ON active.webhook_endpoints
  FOR SELECT USING (org_id = active.get_user_org_id());

CREATE POLICY webhook_endpoints_insert
  ON active.webhook_endpoints
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY webhook_endpoints_update
  ON active.webhook_endpoints
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY webhook_endpoints_delete
  ON active.webhook_endpoints
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 3. webhook_deliveries — histórico de envios
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.webhook_deliveries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id       uuid NOT NULL REFERENCES active.webhook_endpoints(id) ON DELETE CASCADE,
  -- Duplicado pra facilitar RLS sem JOIN no SELECT
  org_id            uuid NOT NULL,
  event_type        text NOT NULL,
  payload           jsonb NOT NULL,
  response_status   int,
  response_body     text,
  response_time_ms  int,
  attempt           int NOT NULL DEFAULT 1,
  status            text NOT NULL CHECK (status IN ('pending', 'success', 'failed')),
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint
  ON active.webhook_deliveries (endpoint_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_org_recent
  ON active.webhook_deliveries (org_id, created_at DESC);

ALTER TABLE active.webhook_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY webhook_deliveries_select
  ON active.webhook_deliveries
  FOR SELECT USING (org_id = active.get_user_org_id());

-- INSERT/UPDATE só via service_role (worker/API). Não expomos pra client.
CREATE POLICY webhook_deliveries_insert
  ON active.webhook_deliveries
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY webhook_deliveries_update
  ON active.webhook_deliveries
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 4. Channel type 'email' — adicionado ao CHECK constraint
-- ────────────────────────────────────────────────────────────
-- Email vai entrar como provider stub (Bloco C / PARTE 3); só
-- garantimos que o enum aceita.

ALTER TABLE active.channels
  DROP CONSTRAINT IF EXISTS channels_channel_type_check;

ALTER TABLE active.channels
  ADD CONSTRAINT channels_channel_type_check
  CHECK (channel_type IN (
    'whatsapp', 'whatsapp_free', 'instagram', 'messenger', 'telegram',
    'email', 'webchat', 'tiktok', 'mercadolivre'
  ));
