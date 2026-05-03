-- ============================================================
-- 022: Integrações de calendário externo (Google + Outlook + Calendly)
-- ============================================================
-- Cada agente conecta seu próprio Google/Calendly. Os tokens vivem
-- criptografados (encrypt() do módulo crypto.helper), mas como todo o
-- acesso a essa tabela passa pela API com auth, RLS por org_id é
-- a primeira linha de defesa.
--
-- Sync bidirecional: appointments do CRM viram eventos no Google e
-- vice-versa. webhook_channel_id armazena o canal de push notifications
-- do Google Calendar (renovado a cada 7 dias).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.calendar_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES active.org_members(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook', 'calendly')),

  /** Tokens — devem chegar JÁ criptografados (AES-256-GCM via ENCRYPTION_KEY) */
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,

  /** Calendário escolhido (id + nome). Pra Google = primary geralmente. */
  calendar_id text,
  calendar_name text,

  /** Quando ativo, syncToGoogle/syncFromGoogle são chamados em mutações. */
  sync_enabled boolean NOT NULL DEFAULT true,

  /** Quando true, getAvailableSlots usa freebusy do Google pra excluir
      conflitos com agenda pessoal do agente. */
  consider_personal_events boolean NOT NULL DEFAULT true,

  /** Quando true, eventos novos no Google aparecem como appointments no CRM. */
  bidirectional_sync boolean NOT NULL DEFAULT true,

  /** Auto-cria deal quando alguém agenda via Calendly. */
  auto_create_deal boolean NOT NULL DEFAULT false,

  last_synced_at timestamptz,

  /** Push notifications channel id (Google) ou webhook id (Calendly) */
  webhook_channel_id text,
  webhook_resource_id text,
  webhook_expiration timestamptz,

  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'expired', 'revoked', 'error', 'pending')),
  last_error text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, agent_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_agent
  ON active.calendar_integrations (org_id, agent_id);

CREATE INDEX IF NOT EXISTS idx_calendar_integrations_active
  ON active.calendar_integrations (org_id, provider, status)
  WHERE status = 'active' AND sync_enabled = true;

ALTER TABLE active.calendar_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.calendar_integrations;
CREATE POLICY "org_isolation" ON active.calendar_integrations
  FOR ALL USING (org_id = active.get_user_org_id());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_calendar_integrations_updated_at ON active.calendar_integrations;
    EXECUTE 'CREATE TRIGGER trg_calendar_integrations_updated_at BEFORE UPDATE ON active.calendar_integrations FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;
