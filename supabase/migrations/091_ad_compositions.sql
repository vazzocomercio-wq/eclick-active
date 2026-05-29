-- ============================================================
-- 091: ad_compositions — campanhas AUTORADAS no Active (publish-back Meta)
-- ============================================================
-- Bloco "Publish" (Onda 1) do Active Intelligence.
--
-- Diferença pra active.ad_campaigns:
--   - ad_campaigns = espelho READ-ONLY do que existe no Meta (sync).
--   - ad_compositions = rascunho que NÓS compomos no Active e publicamos
--     no Meta via Marketing API (reusa o token vivo de ad_integrations,
--     que já tem scope ads_management).
--
-- Fluxo de status:
--   draft → ready → publishing → published   (caminho feliz)
--                             ↘ failed        (erro no Graph; last_error)
--   published → paused / archived            (pós-publicação)
--
-- Ao publicar, gravamos external_campaign_id/adset_id/ad_ids. O AdsSync
-- (Bloco C) depois enxerga a campanha como ad_campaigns normal e puxa
-- métricas — sem caminho duplicado de leitura.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_compositions (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  /** Integração (conta de anúncios) que vai veicular. Token vem daqui. */
  integration_id       uuid NOT NULL REFERENCES active.ad_integrations(id) ON DELETE CASCADE,
  platform             text NOT NULL DEFAULT 'meta' CHECK (platform IN ('meta')),
  /** Denormalizado da integração no momento da criação (ex: "act_111..."). */
  ad_account_id        text NOT NULL,
  /** Facebook Page que assina o anúncio — obrigatório no object_story_spec. */
  page_id              text,
  /** Instagram actor id (opcional — veicular tb no IG). */
  instagram_actor_id   text,
  /** Referência livre ao produto de origem (SaaS product id / SKU / catálogo). */
  product_ref          text,

  name                 text NOT NULL,
  /** traffic|conversions|engagement|awareness|catalog_sales|leads */
  objective            text NOT NULL DEFAULT 'traffic'
                         CHECK (objective IN ('traffic','conversions','engagement','awareness','catalog_sales','leads')),
  /** Override opcional do optimization_goal do ad set (senão mapeado do objective). */
  optimization_goal    text,

  status               text NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft','ready','publishing','published','failed','paused','archived')),

  /** Spec de targeting do Meta (age_min/max, genders, geo_locations, interests…). */
  targeting            jsonb NOT NULL DEFAULT '{}'::jsonb,

  /** Orçamento em CENTAVOS da moeda da conta (Meta usa cents). */
  budget_daily_cents   bigint NOT NULL DEFAULT 3000,
  budget_total_cents   bigint,
  duration_days        integer NOT NULL DEFAULT 7,
  /** LOWEST_COST_WITHOUT_CAP | LOWEST_COST_WITH_BID_CAP | COST_CAP | LOWEST_COST_WITH_MIN_ROAS */
  bid_strategy         text NOT NULL DEFAULT 'LOWEST_COST_WITHOUT_CAP',
  /** Valor do cap em centavos quando bid_strategy != LOWEST_COST_WITHOUT_CAP. */
  bid_amount_cents     bigint,
  /** [] | ['CREDIT'] | ['EMPLOYMENT'] | ['HOUSING'] | ['ISSUES_ELECTIONS_POLITICS'] */
  special_ad_categories text[] NOT NULL DEFAULT '{}',

  /** [{variant, headline, primary_text, description, cta, angle, image_url, image_hash}] */
  ad_copies            jsonb NOT NULL DEFAULT '[]'::jsonb,
  destination_url      text,
  utm_params           jsonb NOT NULL DEFAULT '{}'::jsonb,

  /** IDs reais no Meta após publish. */
  external_campaign_id text,
  external_adset_id    text,
  external_ad_ids      text[] NOT NULL DEFAULT '{}',
  published_at         timestamptz,
  last_error           text,

  /** Origem da composição (ia|manual|boost|automation) + tokens/modelo. */
  generation_metadata  jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_compositions_org_status
  ON active.ad_compositions (org_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_compositions_integration
  ON active.ad_compositions (integration_id);

CREATE INDEX IF NOT EXISTS idx_ad_compositions_external_campaign
  ON active.ad_compositions (external_campaign_id)
  WHERE external_campaign_id IS NOT NULL;

ALTER TABLE active.ad_compositions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_compositions;
CREATE POLICY "org_isolation" ON active.ad_compositions
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_ad_compositions_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_compositions_updated_at ON active.ad_compositions;
CREATE TRIGGER tg_ad_compositions_updated_at
  BEFORE UPDATE ON active.ad_compositions
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_compositions_updated_at();

COMMENT ON TABLE active.ad_compositions IS
  'Campanhas autoradas no Active e publicadas no Meta via Marketing API (reusa token de ad_integrations com scope ads_management). Espelhadas depois em ad_campaigns pelo sync.';
