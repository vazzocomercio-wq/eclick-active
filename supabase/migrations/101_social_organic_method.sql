-- ═══════════════════════════════════════════════════
-- 101: Método de Crescimento Orgânico (Maestros) — Pilares 1 e 2
--
-- Adapta o método "crescimento orgânico" ao Radar de Conteúdo existente:
--
--   Pilar 1 — Inteligência Global: curadoria de 20-100 PERFIS de referência
--     do nicho (mundo inteiro), multi-rede. Diferente de trend_monitors
--     (que minera por hashtag/keyword), trend_profiles minera os POSTS
--     desses perfis específicos (modelagem do que já está validado).
--
--   Pilar 2 — Engenharia Reversa: decompõe os posts vencedores em PADRÕES
--     (hook / formato / CTA / som / cenário / por que funciona). Esses
--     padrões alimentam o roteirista ("modele a ESTRUTURA, não copie").
--
-- Conectores de perfil (instagram/tiktok via Apify) populam trend_items
-- marcando origin='profile' + profile_id. Agnóstico de rede: adicionar X/
-- YouTube = só um conector novo + registrar. ZERO mudança no schema.
-- ═══════════════════════════════════════════════════

-- ─── 1) Perfis de referência — a "Inteligência Global" (Pilar 1) ──────
CREATE TABLE IF NOT EXISTS active.trend_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid,                                   -- binding opcional a uma marca (sem FK p/ robustez)

  network text NOT NULL,                           -- instagram | tiktok | youtube | x ...
  handle text NOT NULL,                            -- normalizado, sem '@'
  display_name text,
  url text,
  country text,                                    -- país de origem (vantagem de pioneirismo)
  category text,                                   -- nicho
  followers integer,

  is_active boolean NOT NULL DEFAULT true,
  notes text,
  last_collected_at timestamptz,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, network, handle)
);

CREATE INDEX IF NOT EXISTS idx_trend_profiles_org
  ON active.trend_profiles (org_id, is_active);
CREATE INDEX IF NOT EXISTS idx_trend_profiles_org_network
  ON active.trend_profiles (org_id, network);

-- ─── 2) Marca a origem dos itens minerados ───────────────────────────
-- origin = de onde veio o item: 'hashtag' (monitor), 'profile' (perfil
-- curado), 'trend' (creative center), 'ad' (ad library). profile_id liga
-- ao perfil quando origin='profile' (engenharia reversa prioriza esses).
ALTER TABLE active.trend_items ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE active.trend_items ADD COLUMN IF NOT EXISTS profile_id uuid;

CREATE INDEX IF NOT EXISTS idx_trend_items_org_origin
  ON active.trend_items (org_id, origin, score DESC);

-- ─── 3) Padrões vencedores decompostos — Engenharia Reversa (Pilar 2) ─
CREATE TABLE IF NOT EXISTS active.trend_patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid,

  category text,
  network text,
  source_item_ids uuid[] NOT NULL DEFAULT '{}',    -- trend_items que sustentam o padrão

  hook text,                                       -- o gancho de abertura (verbatim/adaptável)
  hook_type text,                                  -- ex: "myth_buster", "hidden_truth", "warning"
  format text,                                     -- ex: "talking-head 15s", "antes/depois", "listicle"
  structure text,                                  -- ex: "Dor → Solução → Prova"
  cta text,
  sound text,                                      -- som/trilha quando relevante (TikTok)
  scenario text,                                   -- cenário/setting
  why_it_works text,                               -- por que performou (insight)
  example_caption text,

  score numeric(12,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  cost_usd numeric(10,4) NOT NULL DEFAULT 0,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trend_patterns_org
  ON active.trend_patterns (org_id, is_active, score DESC);
CREATE INDEX IF NOT EXISTS idx_trend_patterns_org_category
  ON active.trend_patterns (org_id, category, score DESC);

-- ─── RLS + GRANT (mesmo padrão das demais tabelas active) ────────────
ALTER TABLE active.trend_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.trend_patterns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trend_profiles_org" ON active.trend_profiles
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "trend_patterns_org" ON active.trend_patterns
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_profiles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.trend_patterns TO authenticated, service_role;

-- PostgREST: recarrega o schema cache (novas tabelas/colunas)
NOTIFY pgrst, 'reload schema';
