-- ═══════════════════════════════════════════════════
-- 057: Social Ad Boost — drafts de promoção de hit posts
-- Quando um social_signal de tipo 'hit_post' é detectado,
-- ou usuário clica "Promover como ad" no detalhe, criamos
-- um draft com sugestões de IA (budget, audiência, copy).
-- O draft é levado pelo usuário ao Meta Ads Manager via
-- deep link — não cria campanha automaticamente pra evitar
-- gastar dinheiro sem confirmação.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_ad_boost_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,
  signal_id uuid REFERENCES active.social_signals(id) ON DELETE SET NULL,

  -- Configuração do boost
  platform text NOT NULL DEFAULT 'meta' CHECK (platform IN ('meta', 'google', 'tiktok_ads')),
  objective text NOT NULL DEFAULT 'OUTCOME_ENGAGEMENT' CHECK (objective IN (
    'OUTCOME_AWARENESS', 'OUTCOME_TRAFFIC', 'OUTCOME_ENGAGEMENT',
    'OUTCOME_LEADS', 'OUTCOME_APP_PROMOTION', 'OUTCOME_SALES'
  )),
  daily_budget_cents bigint NOT NULL DEFAULT 5000, -- R$ 50/dia default
  duration_days integer NOT NULL DEFAULT 7,

  -- Audiência (sugerida pela IA, editável pelo usuário)
  target_locations text[] NOT NULL DEFAULT '{Brasil}',
  target_age_min integer DEFAULT 18,
  target_age_max integer DEFAULT 55,
  target_genders text[] DEFAULT '{all}',
  target_interests text[] NOT NULL DEFAULT '{}',
  target_audience_summary text,

  -- Sugestões IA
  ai_budget_rationale text,
  ai_audience_rationale text,
  ai_copy_suggestions jsonb NOT NULL DEFAULT '[]',

  -- Estado
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',          -- recém criado
    'reviewed',       -- usuário revisou
    'sent_to_platform', -- usuário clicou no deep link
    'live',           -- campanha está rodando (sync via ad_campaigns)
    'paused',
    'completed',
    'cancelled'
  )),

  -- Vinculação com ad_campaigns quando o usuário cria de fato
  external_campaign_id text,
  external_account_id text,
  meta_deep_link text,

  -- Tracking
  reviewed_at timestamptz,
  sent_to_platform_at timestamptz,
  reviewed_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_boost_drafts_org ON active.social_ad_boost_drafts(org_id, created_at DESC);
CREATE INDEX idx_boost_drafts_content ON active.social_ad_boost_drafts(content_id);
CREATE INDEX idx_boost_drafts_status ON active.social_ad_boost_drafts(org_id, status);
CREATE INDEX idx_boost_drafts_signal ON active.social_ad_boost_drafts(signal_id) WHERE signal_id IS NOT NULL;

CREATE TRIGGER trg_boost_drafts_updated_at
  BEFORE UPDATE ON active.social_ad_boost_drafts
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- RLS
ALTER TABLE active.social_ad_boost_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "boost_drafts_org" ON active.social_ad_boost_drafts
  FOR ALL USING (org_id = active.get_user_org_id());

-- Realtime — UI mostra novo draft quando cria via signal acknowledge
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_ad_boost_drafts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_ad_boost_drafts TO authenticated, service_role;
