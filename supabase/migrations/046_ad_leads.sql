-- ============================================================
-- 046: ad_leads — leads recebidos via Meta Lead Ads webhook
-- ============================================================
-- Bloco F do Active Intelligence: Meta envia leadgen_id quando alguém
-- preenche um formulário num anúncio. Webhook chama a Graph API pra
-- expandir o lead → cria contact + conversation + dispara greeting
-- (cold outbound). Tag LEAD_META_<campaign_slug> aplicada pro funil.
--
-- contact_id/conversation_id são populados após processamento. NULL
-- enquanto pending (raw_payload guarda o webhook bruto pra auditoria
-- e retry).
--
-- processed_at: quando o handler terminou (mesmo se falhou — error_message
-- preenchido). Sem isso, retry infinito em loop.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_leads (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  platform             text NOT NULL DEFAULT 'meta'
    CHECK (platform IN ('meta', 'google')),
  /** ID do leadgen_id no Meta (ou equivalente). Único globalmente. */
  external_lead_id     text NOT NULL,
  /** Form ID que gerou o lead (Meta form_id). */
  source_form_id       text,
  /** ad_id que o user clicou — pra atribuição last-click. */
  source_ad_id         text,
  /** Campaign relacionada (resolvida via ad_id → ad_campaigns). */
  campaign_id          uuid REFERENCES active.ad_campaigns(id) ON DELETE SET NULL,
  /** Phone extraído dos field_data do form. Pode ser null se form não pediu. */
  phone                text,
  -- Outros campos comuns do form_data extraídos
  email                text,
  name                 text,
  /** Payload bruto do webhook (entry[0].changes[0].value + lead expandido) */
  raw_payload          jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Vínculos criados após processamento. */
  contact_id           uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  conversation_id      uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  /** True se HMAC X-Hub-Signature-256 bateu com META_APP_SECRET. */
  hmac_verified        boolean NOT NULL DEFAULT false,
  processed_at         timestamptz,
  error_message        text,
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Dedupe por external_lead_id global (Meta não envia 2x mas vale defesa)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_leads_external_id
  ON active.ad_leads (platform, external_lead_id);

CREATE INDEX IF NOT EXISTS idx_ad_leads_org_processed
  ON active.ad_leads (org_id, processed_at NULLS FIRST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_leads_campaign
  ON active.ad_leads (campaign_id, created_at DESC);

-- Índice pro signal lead_unattended: leads com contact criado mas sem
-- inbound recente do contact
CREATE INDEX IF NOT EXISTS idx_ad_leads_contact
  ON active.ad_leads (contact_id, created_at DESC)
  WHERE contact_id IS NOT NULL;

ALTER TABLE active.ad_leads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_leads;
CREATE POLICY "org_isolation" ON active.ad_leads
  FOR ALL USING (org_id = active.get_user_org_id());

COMMENT ON TABLE active.ad_leads IS
  'Leads de Meta Lead Ads (Bloco F). raw_payload preservado pra audit/retry.';
