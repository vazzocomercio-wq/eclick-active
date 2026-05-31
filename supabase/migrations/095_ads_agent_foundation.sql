-- ═══════════════════════════════════════════════════════════════════
-- 095 — Ads Performance Agent (F12) — fundação do motor
--
-- Motor de OTIMIZAÇÃO de anúncios PLATFORM-AGNOSTIC. O motor nunca conhece
-- "Meta" — só conhece entidades e métricas NORMALIZADAS. Cada plataforma
-- (meta hoje; tiktok/mercadolivre/shopee/x/linkedin/pinterest/google depois)
-- entra como um ADAPTADOR no TypeScript. Aqui só vive o modelo canônico.
--
-- ┌─ DECISÃO DE SCHEMA ────────────────────────────────────────────────┐
-- │ A spec pede `schema ads`. Mas o PostgREST do Supabase só expõe       │
-- │ schemas listados em db-schemas, e adicionar exige Management API     │
-- │ (sem token) — MESMO motivo da migration 088 (prospect.* → active.*).│
-- │ Então as tabelas moram em `active.ads_*` (prefixo plural, distinto   │
-- │ do legado Meta-específico `ad_*`: ad_integrations/ad_campaigns/      │
-- │ ad_compositions/ad_audiences/ad_actions). A arquitetura agnóstica    │
-- │ vive 100% no contrato AdProvider (TypeScript), não no nome do schema.│
-- └─────────────────────────────────────────────────────────────────────┘
--
-- ⚠️ ML landmine: ML aparece como 'mercadolivre' (sem _) em orders/
-- product_listings e 'mercado_livre' (com _) em seller_account_suppliers.
-- Aqui o CANÔNICO é 'mercadolivre'. O adaptador de ML Ads reconcilia.
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;

-- ───────────────────────────────────────────────────────────────────
-- accounts — contas de anúncio conectadas (1 por plataforma+conta)
-- ───────────────────────────────────────────────────────────────────
-- credential_ref = id da active.ad_integrations (NUNCA o token cru).
-- O MetaProvider resolve o token via AdIntegrationsService.getAccessToken.
CREATE TABLE active.ads_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  platform            text NOT NULL CHECK (platform IN (
                        'meta','tiktok','mercadolivre','shopee','x','linkedin','pinterest','google')),
  external_account_id text NOT NULL,                 -- act_xxx (Meta), advertiser_id (TikTok)...
  name                text,
  currency            char(3) NOT NULL DEFAULT 'BRL',
  timezone            text   NOT NULL DEFAULT 'America/Sao_Paulo',
  credential_ref      text   NOT NULL,               -- → active.ad_integrations.id (referência, não token)
  status              text   NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','paused','error','disconnected')),
  spend_tier          text   NOT NULL DEFAULT 'standard'
                        CHECK (spend_tier IN ('low','standard','high')),
  last_polled_at      timestamptz,
  error_message       text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, external_account_id)
);
CREATE INDEX idx_ads_accounts_org      ON active.ads_accounts (org_id, platform);
CREATE INDEX idx_ads_accounts_polling  ON active.ads_accounts (status, spend_tier, last_polled_at);

ALTER TABLE active.ads_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_accounts_org" ON active.ads_accounts
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_ads_accounts_updated_at
  BEFORE UPDATE ON active.ads_accounts
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- entities — hierarquia unificada campanha → conjunto → anúncio
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_entities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,  -- denormalizado p/ RLS
  account_id   uuid NOT NULL REFERENCES active.ads_accounts(id) ON DELETE CASCADE,
  parent_id    uuid REFERENCES active.ads_entities(id) ON DELETE CASCADE,
  level        text NOT NULL CHECK (level IN ('campaign','adset','ad')),
  platform     text NOT NULL,
  external_id  text NOT NULL,
  name         text,
  objective    text,        -- NORMALIZADO: conversions|traffic|reach|leads|catalog_sales...
  status       text NOT NULL,-- NORMALIZADO: active|paused|archived
  budget_cents bigint,       -- orçamento normalizado em centavos
  budget_type  text CHECK (budget_type IN ('daily','lifetime') OR budget_type IS NULL),
  raw          jsonb,        -- payload bruto da plataforma (auditoria/debug)
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, external_id)
);
CREATE INDEX idx_ads_entities_account ON active.ads_entities (account_id, level);
CREATE INDEX idx_ads_entities_parent  ON active.ads_entities (parent_id);
CREATE INDEX idx_ads_entities_org     ON active.ads_entities (org_id);

ALTER TABLE active.ads_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_entities_org" ON active.ads_entities
  FOR ALL USING (org_id = active.get_user_org_id());

-- ───────────────────────────────────────────────────────────────────
-- insights — time-series do polling. DERIVADAS calculadas aqui via
-- GENERATED STORED (nunca confiar no número da plataforma).
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_insights (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id        uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,  -- denormalizado p/ RLS
  entity_id     uuid NOT NULL REFERENCES active.ads_entities(id) ON DELETE CASCADE,
  level         text NOT NULL CHECK (level IN ('campaign','adset','ad')),
  date          date NOT NULL,
  -- BRUTAS normalizadas (todo provider mapeia pra cá):
  spend_cents   bigint  NOT NULL DEFAULT 0,
  impressions   bigint  NOT NULL DEFAULT 0,
  clicks        bigint  NOT NULL DEFAULT 0,
  conversions   numeric NOT NULL DEFAULT 0,
  revenue_cents bigint  NOT NULL DEFAULT 0,
  frequency     numeric,
  reach         bigint,
  -- DERIVADAS (calculadas aqui):
  cpa_cents bigint  GENERATED ALWAYS AS
    (CASE WHEN conversions > 0 THEN (spend_cents / conversions)::bigint END) STORED,
  roas      numeric GENERATED ALWAYS AS
    (CASE WHEN spend_cents  > 0 THEN revenue_cents::numeric / spend_cents END) STORED,
  ctr       numeric GENERATED ALWAYS AS
    (CASE WHEN impressions  > 0 THEN clicks::numeric / impressions END) STORED,
  cpm_cents bigint  GENERATED ALWAYS AS
    (CASE WHEN impressions  > 0 THEN (spend_cents * 1000 / impressions)::bigint END) STORED,
  raw          jsonb,
  collected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, date)
);
CREATE INDEX idx_ads_insights_entity_date ON active.ads_insights (entity_id, date DESC);
CREATE INDEX idx_ads_insights_org_date    ON active.ads_insights (org_id, date DESC);

ALTER TABLE active.ads_insights ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_insights_org" ON active.ads_insights
  FOR ALL USING (org_id = active.get_user_org_id());

-- ───────────────────────────────────────────────────────────────────
-- decisions — decisões do agente (copiloto/auto)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_decisions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_id   uuid NOT NULL REFERENCES active.ads_entities(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES active.ads_accounts(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN (
                'scale_budget','reduce_budget','pause','activate','adjust_bid','reallocate')),
  rationale   text NOT NULL,   -- explicação em linguagem natural (LLM)
  signals     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- métricas que motivaram (snapshot)
  "before"    jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {budget_cents: 5000}
  "after"     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {budget_cents: 7500}
  confidence  numeric NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 1),
  mode        text NOT NULL CHECK (mode IN ('copilot','auto')),
  status      text NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','approved','rejected','applied','failed','rolled_back')),
  rule_id     uuid,            -- regra que disparou/avalizou (nullable)
  error_message text,
  applied_at  timestamptz,
  measure_after timestamptz,   -- quando medir o outcome (default +72h, setado na criação)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_decisions_org_status ON active.ads_decisions (org_id, status, created_at DESC);
CREATE INDEX idx_ads_decisions_entity     ON active.ads_decisions (entity_id, created_at DESC);
CREATE INDEX idx_ads_decisions_measure    ON active.ads_decisions (status, measure_after)
  WHERE status = 'applied';

ALTER TABLE active.ads_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_decisions_org" ON active.ads_decisions
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_ads_decisions_updated_at
  BEFORE UPDATE ON active.ads_decisions
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- outcomes — resultado medido (LOOP DE APRENDIZADO)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_outcomes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  decision_id    uuid NOT NULL REFERENCES active.ads_decisions(id) ON DELETE CASCADE,
  window_hours   int  NOT NULL DEFAULT 72,
  before_metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_metrics  jsonb NOT NULL DEFAULT '{}'::jsonb,
  delta          jsonb NOT NULL DEFAULT '{}'::jsonb,
  verdict        text  NOT NULL CHECK (verdict IN ('positive','negative','neutral')),
  measured_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (decision_id)
);
CREATE INDEX idx_ads_outcomes_org ON active.ads_outcomes (org_id, measured_at DESC);

ALTER TABLE active.ads_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_outcomes_org" ON active.ads_outcomes
  FOR ALL USING (org_id = active.get_user_org_id());

-- ───────────────────────────────────────────────────────────────────
-- knowledge — base de conhecimento vetorizada (pgvector)
-- platform NULL = aprendizado cross-platform (dentro da MESMA org).
-- org_id NOT NULL: isolamento multi-tenant (aprendizado de uma org não
-- vaza pra outra). Aprendizado universal cross-org fica p/ futuro opt-in.
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_knowledge (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  platform    text CHECK (platform IS NULL OR platform IN (
                'meta','tiktok','mercadolivre','shopee','x','linkedin','pinterest','google')),
  pattern     text NOT NULL,         -- "Escalar orçamento >25%/dia derruba ROAS nas 48h seguintes"
  context     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- condições de aplicação
  confidence  numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  observations int NOT NULL DEFAULT 1,  -- nº de vezes confirmado
  embedding   vector(1536),          -- OpenAI text-embedding-3-small
  source_decision_ids uuid[] NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_knowledge_org ON active.ads_knowledge (org_id, platform);

ALTER TABLE active.ads_knowledge ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_knowledge_org" ON active.ads_knowledge
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_ads_knowledge_updated_at
  BEFORE UPDATE ON active.ads_knowledge
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ───────────────────────────────────────────────────────────────────
-- rules — guardrails configuráveis (account_id NULL = global da org)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE active.ads_rules (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  account_id uuid REFERENCES active.ads_accounts(id) ON DELETE CASCADE,  -- NULL = global da org
  scope      text CHECK (scope IS NULL OR scope IN ('campaign','adset','ad')),
  name       text NOT NULL,
  condition  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {metric:'roas', op:'<', value:1.0, min_spend_cents:3000}
  action     text NOT NULL CHECK (action IN ('suggest','auto_apply','block')),
  limits     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {max_budget_change_pct:20, min_data_hours:48}
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_ads_rules_org ON active.ads_rules (org_id, enabled);

ALTER TABLE active.ads_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ads_rules_org" ON active.ads_rules
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_ads_rules_updated_at
  BEFORE UPDATE ON active.ads_rules
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ═══════════════════════════════════════════════════════════════════
-- RPC de similaridade da KB (RAG) — usado no passo RETRIEVE (MVP-3).
-- Criado já pra fixar o contrato; retorna padrões da MESMA org ordenados
-- por similaridade de cosseno. SECURITY DEFINER + filtro org explícito.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION active.ads_knowledge_search(
  p_org_id    uuid,
  p_embedding vector(1536),
  p_platform  text DEFAULT NULL,
  p_limit     int  DEFAULT 5
)
RETURNS TABLE (
  id           uuid,
  pattern      text,
  context      jsonb,
  confidence   numeric,
  observations int,
  similarity   real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = active, public
AS $$
  SELECT k.id, k.pattern, k.context, k.confidence, k.observations,
         1 - (k.embedding <=> p_embedding) AS similarity
  FROM active.ads_knowledge k
  WHERE k.org_id = p_org_id
    AND k.embedding IS NOT NULL
    AND (p_platform IS NULL OR k.platform IS NULL OR k.platform = p_platform)
  ORDER BY k.embedding <=> p_embedding
  LIMIT GREATEST(p_limit, 1);
$$;
