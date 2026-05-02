-- ============================================================
-- 014: AI agent personas + business hours + AI test conversations
-- ============================================================
-- Bloco E:
--   1. active.ai_agent_personas — config de persona (nome, tom, diretrizes)
--   2. active.organizations.business_hours — horário comercial por org
--   3. active.ai_test_conversations — sandbox pra testar persona sem
--      afetar contatos/deals reais (TTL 24h)
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ai_agent_personas
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.ai_agent_personas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  avatar_url      text,
  role            text NOT NULL DEFAULT 'sales_assistant'
                  CHECK (role IN ('sales_assistant', 'support_agent', 'receptionist', 'custom')),
  personality     text,
  tone            text NOT NULL DEFAULT 'semiformal'
                  CHECK (tone IN ('formal', 'semiformal', 'casual', 'friendly')),
  response_length text NOT NULL DEFAULT 'medium'
                  CHECK (response_length IN ('short', 'medium', 'detailed')),
  language        text NOT NULL DEFAULT 'pt-BR',
  response_delay_seconds int NOT NULL DEFAULT 0
                  CHECK (response_delay_seconds >= 0 AND response_delay_seconds <= 60),
  guidelines      text[] NOT NULL DEFAULT '{}',
  forbidden_topics text[] NOT NULL DEFAULT '{}',
  greeting_message  text,
  fallback_message  text,
  is_default      boolean NOT NULL DEFAULT false,
  is_active       boolean NOT NULL DEFAULT true,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_personas_org_default
  ON active.ai_agent_personas (org_id)
  WHERE is_default = true AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ai_agent_personas_org_active
  ON active.ai_agent_personas (org_id, is_active);

-- Garante apenas 1 default por org via partial unique index
CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_agent_personas_one_default_per_org
  ON active.ai_agent_personas (org_id)
  WHERE is_default = true;

CREATE TRIGGER trg_ai_agent_personas_updated_at
  BEFORE UPDATE ON active.ai_agent_personas
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.ai_agent_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_agent_personas_select ON active.ai_agent_personas
  FOR SELECT USING (org_id = active.get_user_org_id());
CREATE POLICY ai_agent_personas_insert ON active.ai_agent_personas
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_agent_personas_update ON active.ai_agent_personas
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_agent_personas_delete ON active.ai_agent_personas
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 2. organizations.business_hours
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.organizations
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{
    "enabled": false,
    "timezone": "America/Sao_Paulo",
    "schedule": {
      "mon": {"start": "08:00", "end": "18:00", "enabled": true},
      "tue": {"start": "08:00", "end": "18:00", "enabled": true},
      "wed": {"start": "08:00", "end": "18:00", "enabled": true},
      "thu": {"start": "08:00", "end": "18:00", "enabled": true},
      "fri": {"start": "08:00", "end": "18:00", "enabled": true},
      "sat": {"start": "09:00", "end": "13:00", "enabled": false},
      "sun": {"enabled": false}
    }
  }'::jsonb;

-- ────────────────────────────────────────────────────────────
-- 3. ai_test_conversations (sandbox pra modo teste)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.ai_test_conversations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  persona_id  uuid REFERENCES active.ai_agent_personas(id) ON DELETE SET NULL,
  user_id     uuid NOT NULL,
  messages    jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- TTL: rows mais velhas que 24h são limpas pelo cron (ver abaixo)
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '24 hours')
);

CREATE INDEX IF NOT EXISTS idx_ai_test_conversations_org_user
  ON active.ai_test_conversations (org_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_test_conversations_expires_at
  ON active.ai_test_conversations (expires_at);

CREATE TRIGGER trg_ai_test_conversations_updated_at
  BEFORE UPDATE ON active.ai_test_conversations
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.ai_test_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_test_conversations_select ON active.ai_test_conversations
  FOR SELECT USING (org_id = active.get_user_org_id());
CREATE POLICY ai_test_conversations_insert ON active.ai_test_conversations
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_test_conversations_update ON active.ai_test_conversations
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_test_conversations_delete ON active.ai_test_conversations
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 4. Cron: limpar test conversations expiradas (15 min interval)
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION active.cleanup_expired_test_conversations()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = active, pg_temp
AS $$
DECLARE
  v_deleted int;
BEGIN
  DELETE FROM active.ai_test_conversations
  WHERE expires_at < now();
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

-- Tenta agendar via pg_cron (se a extensão estiver habilitada)
DO $$
BEGIN
  PERFORM cron.schedule(
    'active-cleanup-test-conversations',
    '*/15 * * * *',
    'SELECT active.cleanup_expired_test_conversations()'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron não disponível (skipping schedule): %', SQLERRM;
END $$;
