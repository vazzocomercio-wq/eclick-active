-- ============================================================
-- 042: ad_campaigns — campanhas sincronizadas do Meta/Google
-- ============================================================
-- Bloco C do Active Intelligence: cada integração ativa em
-- ad_integrations sincroniza suas campaigns. Não particionada (volume
-- baixo — orgs têm dezenas de campaigns, não milhões).
--
-- external_id é o ID na plataforma (ex: "23843719042830240" no Meta).
-- raw guarda o payload bruto pra auditoria + features futuras (objective
-- detalhado, special_ad_categories, etc.).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_campaigns (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  integration_id  uuid NOT NULL REFERENCES active.ad_integrations(id) ON DELETE CASCADE,
  platform        text NOT NULL CHECK (platform IN ('meta', 'google')),
  /** ID da campaign na plataforma (ex: "23843719042830240" Meta). */
  external_id     text NOT NULL,
  name            text NOT NULL,
  /** ACTIVE | PAUSED | DELETED | ARCHIVED (Meta); enabled/paused/removed (Google) */
  status          text NOT NULL,
  /** Ex: "OUTCOME_LEADS", "OUTCOME_TRAFFIC", "CONVERSIONS"... */
  objective       text,
  /** Em centavos da moeda da conta (Meta retorna em cents). */
  daily_budget    bigint,
  lifetime_budget bigint,
  started_at      timestamptz,
  ended_at        timestamptz,
  /** Payload bruto da plataforma — debug + features futuras. */
  raw             jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Uma plataforma+external_id é único globalmente (não por org porque
-- duas orgs poderiam conectar a mesma ad_account)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_campaigns_integration_external
  ON active.ad_campaigns (integration_id, external_id);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_org_status
  ON active.ad_campaigns (org_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_ad_campaigns_integration
  ON active.ad_campaigns (integration_id);

ALTER TABLE active.ad_campaigns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_campaigns;
CREATE POLICY "org_isolation" ON active.ad_campaigns
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_ad_campaigns_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_campaigns_updated_at ON active.ad_campaigns;
CREATE TRIGGER tg_ad_campaigns_updated_at
  BEFORE UPDATE ON active.ad_campaigns
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_campaigns_updated_at();

COMMENT ON TABLE active.ad_campaigns IS
  'Campaigns sincronizadas do Meta/Google. raw = payload bruto da plataforma.';
