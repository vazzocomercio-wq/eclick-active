-- ═══════════════════════════════════════════════════
-- 082: Radar de Conteúdo (e-Click Social Intelligence) — fundação
--
-- Camada de TENDÊNCIAS + DADOS INDIVIDUAIS por item.
-- Eixo central = o ITEM individual (vídeo, criativo, som, post). Os sinais
-- de tendência são leitura POR CIMA dos itens.
--
--   trend_monitors — o que monitoramos (categoria/rede/concorrentes/keywords)
--   trend_items    — CADA item cru coletado de uma API externa (rico por fonte)
--   trend_signals  — agregação/leitura ("formato X subindo na categoria Y")
--   trend_briefs   — brief de conteúdo gerado pela IA a partir dos sinais+itens
--
-- Conectores (YouTube/Meta Ad Library/TikTok) populam trend_items nas fases
-- TR-1/TR-2/TR-5. Esta migration só cria a fundação (TR-0).
-- ═══════════════════════════════════════════════════

-- ─── 1) Monitores — o que vigiar ────────────────────────────────
CREATE TABLE IF NOT EXISTS active.trend_monitors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid,                                   -- binding opcional a uma marca (sem FK p/ robustez)

  network text NOT NULL,                           -- youtube | meta_ads | tiktok | google_trends | instagram
  category text NOT NULL,                          -- ex: "iluminação", "decoração"
  keywords text[] NOT NULL DEFAULT '{}',
  competitors jsonb NOT NULL DEFAULT '[]',         -- [{ name, handle, page_id, url }]
  region text NOT NULL DEFAULT 'BR',
  language text NOT NULL DEFAULT 'pt',

  is_active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}',
  last_collected_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_monitors_org
  ON active.trend_monitors (org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_trend_monitors_org_network
  ON active.trend_monitors (org_id, network);

-- ─── 2) Itens crus — 1 linha por item de qualquer API ───────────
CREATE TABLE IF NOT EXISTS active.trend_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  monitor_id uuid REFERENCES active.trend_monitors(id) ON DELETE SET NULL,

  source text NOT NULL,                            -- youtube | meta_ads | tiktok | google_trends | instagram
  external_id text NOT NULL,                       -- id do item na API de origem
  kind text NOT NULL,                              -- video | short | ad_creative | sound | hashtag | search_term | post
  category text,

  title text,
  description text,
  url text,
  thumbnail_url text,
  author_name text,
  author_handle text,
  media_type text,                                 -- video | image | carousel | text
  lang text,
  region text,
  published_at timestamptz,

  metrics jsonb NOT NULL DEFAULT '{}',             -- {views, likes, comments, shares, saves, duration_sec, growth_pct, ...}
  raw jsonb NOT NULL DEFAULT '{}',                 -- payload completo da API (auditoria/futuro)
  score numeric(12,4) NOT NULL DEFAULT 0,          -- score de tendência calculado

  collected_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_trend_items_org_source
  ON active.trend_items (org_id, source, collected_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_items_org_category
  ON active.trend_items (org_id, category, score DESC);
CREATE INDEX IF NOT EXISTS idx_trend_items_monitor
  ON active.trend_items (monitor_id);

-- ─── 3) Sinais — agregação/leitura por cima dos itens ───────────
CREATE TABLE IF NOT EXISTS active.trend_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  monitor_id uuid REFERENCES active.trend_monitors(id) ON DELETE SET NULL,

  source text NOT NULL,
  category text,
  signal_type text NOT NULL,                       -- format_rising | topic_rising | sound_trending | hashtag_trending | competitor_active | search_spike
  title text NOT NULL,
  summary text,
  score numeric(12,4) NOT NULL DEFAULT 0,
  evidence_item_ids uuid[] NOT NULL DEFAULT '{}',  -- aponta pros trend_items que sustentam o sinal
  payload jsonb NOT NULL DEFAULT '{}',

  window_start date,
  window_end date,
  detected_at timestamptz NOT NULL DEFAULT now(),
  dismissed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_signals_org
  ON active.trend_signals (org_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_trend_signals_org_category
  ON active.trend_signals (org_id, category, score DESC);

-- ─── 4) Briefs — brief de conteúdo gerado pela IA ───────────────
CREATE TABLE IF NOT EXISTS active.trend_briefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES active.trend_signals(id) ON DELETE SET NULL,

  category text,
  title text NOT NULL,
  format text NOT NULL DEFAULT 'reel',             -- reel | post | carousel | story | video
  hook text,
  script text,
  visual_style text,
  suggested_products jsonb NOT NULL DEFAULT '[]',
  hashtags text[] NOT NULL DEFAULT '{}',
  cta text,
  rationale text,

  status text NOT NULL DEFAULT 'draft',            -- draft | used | dismissed
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_briefs_org
  ON active.trend_briefs (org_id, created_at DESC);

-- ─── RLS + GRANT (mesmo padrão das demais tabelas active) ───────
ALTER TABLE active.trend_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.trend_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.trend_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.trend_briefs  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trend_monitors_org" ON active.trend_monitors
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "trend_items_org" ON active.trend_items
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "trend_signals_org" ON active.trend_signals
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "trend_briefs_org" ON active.trend_briefs
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_monitors TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_items   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_signals TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_briefs  TO authenticated, service_role;
