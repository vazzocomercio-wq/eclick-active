-- ═══════════════════════════════════════════════════
-- 060: Análise comparativa marca vs concorrentes
-- IA gera análise estruturada com base em
-- reference_accounts da marca + contexto. Cacheada
-- por marca (refresh manual).
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_competitor_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES active.social_brands(id) ON DELETE CASCADE,

  -- Snapshot dos concorrentes na hora da análise
  competitor_handles text[] NOT NULL DEFAULT '{}',

  -- Output IA (JSON estruturado)
  summary text,
  strengths jsonb NOT NULL DEFAULT '[]',
  weaknesses jsonb NOT NULL DEFAULT '[]',
  opportunities jsonb NOT NULL DEFAULT '[]',
  competitor_estimates jsonb NOT NULL DEFAULT '[]',
  recommendations jsonb NOT NULL DEFAULT '[]',

  -- Tracking
  ai_model text,
  ai_generation_time_ms integer,
  generated_at timestamptz NOT NULL DEFAULT now(),

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_competitor_analyses_brand ON active.social_competitor_analyses(brand_id, created_at DESC);
CREATE INDEX idx_competitor_analyses_org ON active.social_competitor_analyses(org_id, created_at DESC);

CREATE TRIGGER trg_competitor_analyses_updated_at
  BEFORE UPDATE ON active.social_competitor_analyses
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.social_competitor_analyses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitor_analyses_org" ON active.social_competitor_analyses
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_competitor_analyses TO authenticated, service_role;
