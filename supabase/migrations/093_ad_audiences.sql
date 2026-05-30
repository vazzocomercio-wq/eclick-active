-- ============================================================
-- 093: ad_audiences — públicos (Custom Audience do CRM + Lookalike)
-- ============================================================
-- Onda 4 do publish: o diferencial de anunciar DENTRO do CRM — virar a
-- base de contatos em público do Meta (1st-party Custom Audience) e gerar
-- Lookalike a partir dela.
--
-- Privacidade: só guardamos o id externo + contagem. NUNCA gravamos os
-- e-mails/telefones aqui — eles são hasheados (SHA256) no envio e nunca
-- logados. É dado 1st-party da PRÓPRIA org indo pra conta de anúncios da
-- PRÓPRIA org (uso sancionado de Custom Audience).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_audiences (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                        uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  integration_id                uuid NOT NULL REFERENCES active.ad_integrations(id) ON DELETE CASCADE,
  ad_account_id                 text NOT NULL,
  /** ID do público no Meta. */
  external_audience_id          text,
  name                          text NOT NULL,
  type                          text NOT NULL CHECK (type IN ('custom', 'lookalike')),
  /** crm_contacts | lookalike */
  source                        text NOT NULL,
  /** Filtro aplicado no CRM (tag, has_email, etc.) — auditoria. */
  source_filter                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Lookalike: público local de origem + país + ratio. */
  lookalike_source_audience_id  uuid,
  lookalike_country             text,
  lookalike_ratio               numeric,
  /** Quantos registros enviamos (custom) e estimativa do Meta. */
  matched_count                 integer,
  approximate_count             integer,
  status                        text NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'ready', 'error', 'archived')),
  last_error                    text,
  created_by                    uuid,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_audiences_org
  ON active.ad_audiences (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ad_audiences_integration
  ON active.ad_audiences (integration_id);

ALTER TABLE active.ad_audiences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_audiences;
CREATE POLICY "org_isolation" ON active.ad_audiences
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_ad_audiences_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_audiences_updated_at ON active.ad_audiences;
CREATE TRIGGER tg_ad_audiences_updated_at
  BEFORE UPDATE ON active.ad_audiences
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_audiences_updated_at();

COMMENT ON TABLE active.ad_audiences IS
  'Públicos Meta criados a partir do CRM (Custom Audience 1st-party) + Lookalikes. NÃO guarda PII — só id externo + contagem.';
