-- ============================================================
-- 094: ad_actions — piloto automático (Onda 5)
-- ============================================================
-- Log das otimizações que o detector de sinais sugere e que o usuário
-- aplica/dispensa. Liga ad_signals → ação real no Meta (pausar, ajustar
-- orçamento) com aprovação. Serve de auditoria + evita re-sugerir o que já
-- foi tratado (cooldown).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_actions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  integration_id        uuid NOT NULL REFERENCES active.ad_integrations(id) ON DELETE CASCADE,
  /** Sinal de origem (ad_signals). Pode ser null se ação manual. */
  signal_id             uuid,
  /** ID da campanha no Meta. */
  campaign_external_id  text NOT NULL,
  campaign_name         text,
  /** pause | resume | decrease_budget | increase_budget | refresh_creative */
  action_type           text NOT NULL,
  rationale             text,
  /** params da ação (ex: { pct: -0.3 }). */
  params                jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** applied | dismissed | failed */
  status                text NOT NULL CHECK (status IN ('applied', 'dismissed', 'failed')),
  result                jsonb,
  last_error            text,
  created_by            uuid,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_actions_org
  ON active.ad_actions (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_actions_campaign
  ON active.ad_actions (campaign_external_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_actions_signal
  ON active.ad_actions (signal_id) WHERE signal_id IS NOT NULL;

ALTER TABLE active.ad_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_actions;
CREATE POLICY "org_isolation" ON active.ad_actions
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_ad_actions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_actions_updated_at ON active.ad_actions;
CREATE TRIGGER tg_ad_actions_updated_at
  BEFORE UPDATE ON active.ad_actions
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_actions_updated_at();

COMMENT ON TABLE active.ad_actions IS
  'Otimizações do piloto automático (sinal→ação no Meta) aplicadas/dispensadas com aprovação do usuário.';
