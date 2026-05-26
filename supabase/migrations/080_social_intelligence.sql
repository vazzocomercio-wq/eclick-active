-- ═══════════════════════════════════════════════════
-- 080: E-Click Social Intelligence — cérebro "O que postar hoje"
-- Cacheia o plano diário (1 por org/dia) pra não re-gastar IA a cada load.
-- O plano cruza candidatos comerciais (margem/estoque/Radar via bridge SaaS)
-- + sinais de engajamento (melhor formato/horário/top posts).
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS active.social_intelligence_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  date date NOT NULL,

  plan_json jsonb NOT NULL DEFAULT '{}',      -- { suggestions: [...] }
  signals_json jsonb NOT NULL DEFAULT '{}',   -- sinais usados (debug/transparência)
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,

  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, date)
);

CREATE INDEX IF NOT EXISTS idx_sid_org_date
  ON active.social_intelligence_daily (org_id, date DESC);

ALTER TABLE active.social_intelligence_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sid_org" ON active.social_intelligence_daily
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_intelligence_daily
  TO authenticated, service_role;
