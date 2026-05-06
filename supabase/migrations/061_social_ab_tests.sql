-- ═══════════════════════════════════════════════════
-- 061: A/B testing — 2 variantes do mesmo brief
-- competindo. Vencedor = maior engagement_rate na
-- janela de teste.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_ab_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES active.social_brands(id) ON DELETE CASCADE,

  name text NOT NULL,
  hypothesis text,

  -- Variantes (FK pra social_contents)
  variant_a_content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,
  variant_b_content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,

  -- Configuração
  test_duration_days integer NOT NULL DEFAULT 7,

  -- Estado
  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft',       -- variantes geradas, esperando publicar
    'running',     -- ambas publicadas, coletando métricas
    'completed',   -- janela terminou, vencedor declarado
    'cancelled'
  )),

  -- Decisão
  winner_variant text CHECK (winner_variant IN ('a', 'b', 'tie', NULL)),
  winner_content_id uuid REFERENCES active.social_contents(id) ON DELETE SET NULL,
  variant_a_engagement_rate numeric(8,4),
  variant_b_engagement_rate numeric(8,4),
  decision_rationale text,

  started_at timestamptz,
  completed_at timestamptz,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CHECK (variant_a_content_id != variant_b_content_id)
);

CREATE INDEX idx_ab_tests_org ON active.social_ab_tests(org_id, created_at DESC);
CREATE INDEX idx_ab_tests_brand ON active.social_ab_tests(brand_id);
CREATE INDEX idx_ab_tests_status ON active.social_ab_tests(org_id, status);
CREATE INDEX idx_ab_tests_running ON active.social_ab_tests(org_id) WHERE status = 'running';

CREATE TRIGGER trg_ab_tests_updated_at
  BEFORE UPDATE ON active.social_ab_tests
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.social_ab_tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ab_tests_org" ON active.social_ab_tests
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_ab_tests TO authenticated, service_role;
