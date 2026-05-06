-- ═══════════════════════════════════════════════════
-- 062: Slack webhooks pra notificações dos signals
-- (atual: só WhatsApp via alert_managers).
-- ═══════════════════════════════════════════════════

CREATE TABLE active.slack_webhooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  name text NOT NULL,
  webhook_url text NOT NULL,
  channel_name text,

  -- Filtro: receber só certas categorias
  notify_social boolean NOT NULL DEFAULT true,
  notify_ad boolean NOT NULL DEFAULT true,
  notify_sac boolean NOT NULL DEFAULT false,

  -- Severity mínima
  min_severity text NOT NULL DEFAULT 'warning'
    CHECK (min_severity IN ('info', 'warning', 'critical')),

  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_slack_webhooks_org ON active.slack_webhooks(org_id) WHERE is_active = true;

CREATE TRIGGER trg_slack_webhooks_updated_at
  BEFORE UPDATE ON active.slack_webhooks
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.slack_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slack_webhooks_org" ON active.slack_webhooks
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.slack_webhooks TO authenticated, service_role;
