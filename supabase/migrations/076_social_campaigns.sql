-- ═══════════════════════════════════════════════════
-- 076: Social Commerce AI — Autopilot de Campanha (Fase 1)
-- "Produto → 1 clique → N reels/carrosséis/posts + agenda".
--
-- 3 tabelas:
--   social_campaign_recipes — a "receita" configurável (quantidades,
--     estilos, modelo, cadência, autonomia, teto de custo).
--   social_campaigns        — uma execução da receita num produto.
--   social_campaign_assets  — cada peça planejada/gerada (reel/post/carrossel),
--     apontando pra linha de social_contents que o motor já sabe criar.
--
-- Reusa TODO o pipeline existente (geração/aprovação/publicação). Aditivo —
-- não altera nenhuma tabela existente além de uma coluna nullable em
-- social_contents (campaign_id).
-- ═══════════════════════════════════════════════════

-- ─── 1. social_campaign_recipes ──────────────────
CREATE TABLE active.social_campaign_recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,
  name text NOT NULL DEFAULT 'Receita padrão',

  -- Quantidades por produto
  num_reels integer NOT NULL DEFAULT 3 CHECK (num_reels BETWEEN 0 AND 10),
  num_carousels integer NOT NULL DEFAULT 1 CHECK (num_carousels BETWEEN 0 AND 5),
  num_posts integer NOT NULL DEFAULT 3 CHECK (num_posts BETWEEN 0 AND 10),

  -- Estilo & qualidade (ids do catálogo do front: video-styles.ts)
  allowed_video_styles text[] NOT NULL DEFAULT '{}',
  allowed_frameworks text[] NOT NULL DEFAULT '{}',
  video_model text NOT NULL DEFAULT 'sora-2',
  video_duration_seconds integer NOT NULL DEFAULT 8
    CHECK (video_duration_seconds BETWEEN 4 AND 15),

  -- Canais & agenda
  channels text[] NOT NULL DEFAULT '{instagram}',
  cadence_days integer NOT NULL DEFAULT 7 CHECK (cadence_days BETWEEN 1 AND 60),
  preferred_hour integer NOT NULL DEFAULT 18 CHECK (preferred_hour BETWEEN 0 AND 23),

  -- Autonomia (o dial de segurança)
  autonomy_level text NOT NULL DEFAULT 'approval'
    CHECK (autonomy_level IN ('draft', 'approval', 'full_auto')),

  -- Inteligência comercial (Fase 2 — colunas já criadas, OFF por padrão)
  prioritize_high_margin boolean NOT NULL DEFAULT false,
  prioritize_overstock boolean NOT NULL DEFAULT false,
  follow_radar boolean NOT NULL DEFAULT false,

  -- Influenciador IA (Fase 3 — toggle, OFF por padrão)
  use_ai_influencer boolean NOT NULL DEFAULT false,

  -- Gatilho automático no cadastro de produto (Fase 2 — OFF por padrão)
  auto_on_new_product boolean NOT NULL DEFAULT false,

  -- Teto de custo por campanha (USD)
  max_cost_usd numeric(10, 2) NOT NULL DEFAULT 10.00,

  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_camp_recipes_org ON active.social_campaign_recipes(org_id);
-- no máximo uma receita default por org
CREATE UNIQUE INDEX idx_social_camp_recipes_default
  ON active.social_campaign_recipes(org_id) WHERE is_default = true;

CREATE TRIGGER trg_social_camp_recipes_updated_at
  BEFORE UPDATE ON active.social_campaign_recipes
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. social_campaigns ─────────────────────────
CREATE TABLE active.social_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,
  recipe_id uuid REFERENCES active.social_campaign_recipes(id) ON DELETE SET NULL,

  name text NOT NULL,

  -- Produto-alvo (vem do catálogo SaaS via bridge — id é texto, não FK)
  product_ref text,
  product_name text,
  product_image_url text,

  trigger_source text NOT NULL DEFAULT 'manual'
    CHECK (trigger_source IN ('manual', 'product_created', 'batch')),
  autonomy_level text NOT NULL DEFAULT 'approval'
    CHECK (autonomy_level IN ('draft', 'approval', 'full_auto')),

  status text NOT NULL DEFAULT 'generating' CHECK (status IN (
    'generating', 'ready_for_review', 'scheduled', 'completed', 'failed', 'cancelled'
  )),

  planned_counts jsonb NOT NULL DEFAULT '{}',     -- {reels, posts, carousels}
  estimated_cost_usd numeric(10, 2),
  actual_cost_usd numeric(10, 2),

  error_message text,
  created_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,

  metadata jsonb NOT NULL DEFAULT '{}',            -- snapshot da receita
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX idx_social_campaigns_org ON active.social_campaigns(org_id);
CREATE INDEX idx_social_campaigns_status ON active.social_campaigns(org_id, status);
CREATE INDEX idx_social_campaigns_created ON active.social_campaigns(org_id, created_at DESC);

CREATE TRIGGER trg_social_campaigns_updated_at
  BEFORE UPDATE ON active.social_campaigns
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 3. social_campaign_assets ───────────────────
CREATE TABLE active.social_campaign_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  campaign_id uuid NOT NULL REFERENCES active.social_campaigns(id) ON DELETE CASCADE,
  content_id uuid REFERENCES active.social_contents(id) ON DELETE SET NULL,

  asset_type text NOT NULL CHECK (asset_type IN ('reel', 'carousel', 'post')),
  planned_index integer NOT NULL DEFAULT 0,

  -- Direção atribuída pelo planejador de campanha
  angle text,
  style_id text,
  framework_id text,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'generating', 'ready', 'failed', 'approved', 'scheduled', 'published'
  )),
  scheduled_for timestamptz,
  error_message text,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_camp_assets_campaign ON active.social_campaign_assets(campaign_id);
CREATE INDEX idx_social_camp_assets_org ON active.social_campaign_assets(org_id);
CREATE INDEX idx_social_camp_assets_content ON active.social_campaign_assets(content_id);

CREATE TRIGGER trg_social_camp_assets_updated_at
  BEFORE UPDATE ON active.social_campaign_assets
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 4. campaign_id em social_contents ───────────
ALTER TABLE active.social_contents
  ADD COLUMN IF NOT EXISTS campaign_id uuid
    REFERENCES active.social_campaigns(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_social_contents_campaign
  ON active.social_contents(campaign_id) WHERE campaign_id IS NOT NULL;

-- ─── 5. RLS ──────────────────────────────────────
ALTER TABLE active.social_campaign_recipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_campaign_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_camp_recipes_org" ON active.social_campaign_recipes
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_campaigns_org" ON active.social_campaigns
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_camp_assets_org" ON active.social_campaign_assets
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 6. Realtime ─────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_campaigns;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_campaign_assets;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE active.social_campaigns REPLICA IDENTITY DEFAULT;
ALTER TABLE active.social_campaign_assets REPLICA IDENTITY DEFAULT;

-- ─── 7. Grants ───────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_campaign_recipes TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_campaigns TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_campaign_assets TO authenticated, service_role;

COMMENT ON TABLE active.social_campaign_recipes IS
  'Receita configurável do Autopilot de Campanha: quantidades, estilos, modelo, cadência, autonomia, teto de custo.';
COMMENT ON TABLE active.social_campaigns IS
  'Execução de uma receita num produto. Gera N peças via o pipeline social existente.';
COMMENT ON TABLE active.social_campaign_assets IS
  'Cada peça planejada/gerada de uma campanha (reel/post/carrossel) → social_contents.';
