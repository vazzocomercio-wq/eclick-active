-- ═══════════════════════════════════════════════════
-- 070 — Bloco II: Orçamento mensal de IA por org
-- ═══════════════════════════════════════════════════
-- Tracking de custo LLM JÁ existe em `active.ai_interactions` (cost_usd
-- por linha). Faltava: visibilidade + cap operacional.
--
-- Esta tabela é independente de `org_llm_credentials` — orgs em fallback
-- (sem cred configurada, usando ANTHROPIC_API_KEY env) também podem ter
-- budget. Hard-cap protege conta Anthropic principal contra abuso.
--
-- Threshold default 80% mira gerar signal warning ANTES de estourar; cap
-- duro só liga quando lojista marca explicitamente.
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS active.org_ai_budgets (
  org_id                uuid PRIMARY KEY REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- Limite mensal em USD. NULL = sem budget definido (telemetria sem cap).
  monthly_budget_usd    numeric(10, 2),

  -- % do budget pra disparar warning via signal (camada Intelligence Hub).
  -- Default 80%. Ignorado se monthly_budget_usd IS NULL.
  alert_threshold_pct   integer NOT NULL DEFAULT 80
    CHECK (alert_threshold_pct BETWEEN 1 AND 100),

  -- Quando true, LlmService bloqueia chat() ao atingir 100% do budget.
  -- Default false — só telemetria. Marcar explicitamente vira gate.
  hard_cap              boolean NOT NULL DEFAULT false,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE active.org_ai_budgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.org_ai_budgets;
CREATE POLICY "org_isolation" ON active.org_ai_budgets
  FOR ALL USING (org_id = active.get_user_org_id());

-- Trigger pra updated_at automático
CREATE OR REPLACE FUNCTION active.tg_org_ai_budgets_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_org_ai_budgets_updated_at ON active.org_ai_budgets;
CREATE TRIGGER tg_org_ai_budgets_updated_at
  BEFORE UPDATE ON active.org_ai_budgets
  FOR EACH ROW EXECUTE FUNCTION active.tg_org_ai_budgets_updated_at();

-- ──────────────────────────────────────────────────
-- GRANTs — aplicados explicitamente pra evitar bug de criação via RPC
-- ──────────────────────────────────────────────────
GRANT ALL ON TABLE active.org_ai_budgets TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE active.org_ai_budgets TO authenticated;

COMMENT ON TABLE active.org_ai_budgets IS
  'Orçamento mensal de IA por org. monthly_budget_usd null = sem cap. hard_cap=true bloqueia LlmService.chat() ao atingir 100%.';
COMMENT ON COLUMN active.org_ai_budgets.alert_threshold_pct IS
  '% do budget pra disparar signal warning via Intelligence Hub. Default 80%.';
COMMENT ON COLUMN active.org_ai_budgets.hard_cap IS
  'Quando true, LlmService.chat() retorna 400 ao atingir 100% do budget. Default false (só telemetria).';
