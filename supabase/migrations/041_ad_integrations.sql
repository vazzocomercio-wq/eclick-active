-- ============================================================
-- 041: ad_integrations — contas de Ads conectadas via OAuth
-- ============================================================
-- Bloco B do Active Intelligence: cada org pode plugar uma ou mais
-- contas de anúncio (Meta/Google) via OAuth. Tokens cifrados com
-- AES-256-GCM (mesma chave LLM_CRED_ENCRYPTION_KEY).
--
-- Escopo MVP: campaign-level metrics (Bloco C). adset/ad fica Fase 2.
--
-- Status:
--   active        — token válido, sync ok
--   token_expired — refresh falhou, precisa re-conectar
--   error         — última sync falhou (ver error_message)
--   disconnected  — user clicou "desconectar"
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_integrations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  platform                 text NOT NULL CHECK (platform IN ('meta', 'google')),
  /** ID da ad account no provider (ex: act_1234567890 no Meta). */
  ad_account_id            text NOT NULL,
  account_name             text,
  /** AES-GCM ciphertext em base64 (iv||tag||ct). Nunca exposto via API. */
  access_token_ciphertext  text NOT NULL,
  refresh_token_ciphertext text,
  /** Quando o access_token expira (UTC). NULL = não expira (Meta long-lived). */
  expires_at               timestamptz,
  /** Scopes concedidos pelo user no consent screen — separados por espaço. */
  scope                    text,
  status                   text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'token_expired', 'error', 'disconnected')),
  last_sync_at             timestamptz,
  error_message            text,
  /** Metadata livre (ex: {business_id, page_ids[]} pra Meta). */
  metadata                 jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Uma org pode conectar a mesma ad_account só uma vez por plataforma
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_integrations_org_platform_account
  ON active.ad_integrations (org_id, platform, ad_account_id);

CREATE INDEX IF NOT EXISTS idx_ad_integrations_org
  ON active.ad_integrations (org_id, platform, status);

-- Worker procura integrações ativas com expires_at vencido pra rodar refresh
CREATE INDEX IF NOT EXISTS idx_ad_integrations_refresh
  ON active.ad_integrations (expires_at)
  WHERE status = 'active' AND expires_at IS NOT NULL;

ALTER TABLE active.ad_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_integrations;
CREATE POLICY "org_isolation" ON active.ad_integrations
  FOR ALL USING (org_id = active.get_user_org_id());

-- Trigger pra updated_at automático
CREATE OR REPLACE FUNCTION active.tg_ad_integrations_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_integrations_updated_at ON active.ad_integrations;
CREATE TRIGGER tg_ad_integrations_updated_at
  BEFORE UPDATE ON active.ad_integrations
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_integrations_updated_at();

COMMENT ON TABLE active.ad_integrations IS
  'Contas de Ads conectadas via OAuth (Meta, Google). Tokens cifrados AES-GCM.';
COMMENT ON COLUMN active.ad_integrations.access_token_ciphertext IS
  'base64(iv(12) || tag(16) || ciphertext). Decifrado em common/crypto/aes-gcm.util.ts.';
