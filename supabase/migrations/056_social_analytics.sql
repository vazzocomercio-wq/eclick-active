-- ═══════════════════════════════════════════════════
-- 056: Social MVP 3 — Analytics
-- Métricas diárias dos posts publicados + signal detector
-- (hits/flops vs média do pilar) + RPCs agregadas pra UI.
-- ═══════════════════════════════════════════════════

-- ─── 1. social_metrics_daily ─────────────────────
-- 1 row por (content_id, channel, date). Volume muito menor que
-- ad_metrics (por campaign_id), então não particiona — só índices.
-- raw_metrics armazena payload completo do Insights pra evoluir.
CREATE TABLE active.social_metrics_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,

  channel text NOT NULL,
  external_post_id text,
  date date NOT NULL,

  -- Métricas básicas (Instagram Insights padrão)
  reach bigint NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  likes bigint NOT NULL DEFAULT 0,
  comments bigint NOT NULL DEFAULT 0,
  shares bigint NOT NULL DEFAULT 0,
  saved bigint NOT NULL DEFAULT 0,

  -- Profile actions (legacy IG insights)
  profile_visits bigint NOT NULL DEFAULT 0,
  profile_follows bigint NOT NULL DEFAULT 0,

  -- Vídeo (reels)
  video_views bigint NOT NULL DEFAULT 0,
  total_interactions bigint NOT NULL DEFAULT 0,

  -- Engagement rate calculado: (likes + comments + shares + saved) / reach
  -- Calculado client-side pra evitar div-by-zero em rows com reach=0.
  engagement_rate numeric(8,4) NOT NULL DEFAULT 0,

  -- Payload completo
  raw_metrics jsonb NOT NULL DEFAULT '{}',

  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(content_id, channel, date)
);

CREATE INDEX idx_social_metrics_org_date ON active.social_metrics_daily(org_id, date DESC);
CREATE INDEX idx_social_metrics_content ON active.social_metrics_daily(content_id, date DESC);
CREATE INDEX idx_social_metrics_brand ON active.social_metrics_daily(brand_id, date DESC) WHERE brand_id IS NOT NULL;
CREATE INDEX idx_social_metrics_engagement ON active.social_metrics_daily(org_id, engagement_rate DESC) WHERE engagement_rate > 0;

CREATE TRIGGER trg_social_metrics_updated_at
  BEFORE UPDATE ON active.social_metrics_daily
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. social_signals ───────────────────────────
-- Detecções automáticas: posts performando 3× acima/abaixo da média
-- do pilar, melhor horário, hashtag campeã, etc. Espelha pattern
-- de ad_signals (M047).
CREATE TABLE active.social_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,
  content_id uuid REFERENCES active.social_contents(id) ON DELETE CASCADE,

  signal_type text NOT NULL CHECK (signal_type IN (
    'hit_post',          -- post 3×+ acima da média do pilar
    'flop_post',         -- post 50%- abaixo da média
    'best_time_window',  -- janela de horário top
    'best_pillar',       -- pilar performando melhor
    'best_hashtag',      -- hashtag c/ maior alcance
    'declining_trend',   -- queda 7d consecutiva
    'engagement_spike'   -- spike inesperado
  )),
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info', 'warning', 'critical')),

  title text NOT NULL,
  description text,

  -- Contexto numérico
  metric_name text,
  metric_value numeric,
  benchmark_value numeric,
  delta_pct numeric,

  -- Dedup pra evitar gerar sinal igual no mesmo dia
  dedupe_key text NOT NULL,

  detected_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,

  metadata jsonb NOT NULL DEFAULT '{}',
  UNIQUE(org_id, dedupe_key)
);

CREATE INDEX idx_social_signals_org ON active.social_signals(org_id, detected_at DESC);
CREATE INDEX idx_social_signals_unack ON active.social_signals(org_id) WHERE acknowledged_at IS NULL;
CREATE INDEX idx_social_signals_brand ON active.social_signals(brand_id, detected_at DESC);

-- ─── 3. RLS ──────────────────────────────────────
ALTER TABLE active.social_metrics_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_metrics_org" ON active.social_metrics_daily
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_signals_org" ON active.social_signals
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 4. Realtime ─────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_signals;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 5. RPC: Reports agregados pra UI ────────────
-- Resumo por pilar (top performers + média): muito útil pra "qual
-- pilar engaja mais?". Aggregate em SQL evita carregar centenas de
-- rows pro frontend.
CREATE OR REPLACE FUNCTION active.social_report_by_pillar(
  p_org_id uuid,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 30
)
RETURNS TABLE (
  pillar text,
  total_posts bigint,
  avg_engagement_rate numeric,
  avg_reach numeric,
  avg_likes numeric,
  total_interactions bigint
)
LANGUAGE sql STABLE AS $$
  WITH metrics AS (
    SELECT
      c.pillar,
      COUNT(DISTINCT m.content_id) AS posts_count,
      AVG(m.engagement_rate) AS avg_er,
      AVG(m.reach) AS avg_reach,
      AVG(m.likes) AS avg_likes,
      SUM(m.likes + m.comments + m.shares + m.saved) AS total_inter
    FROM active.social_metrics_daily m
    JOIN active.social_contents c ON c.id = m.content_id
    WHERE m.org_id = p_org_id
      AND m.date >= (now()::date - p_since_days)
      AND (p_brand_id IS NULL OR m.brand_id = p_brand_id)
      AND c.pillar IS NOT NULL
    GROUP BY c.pillar
  )
  SELECT
    pillar,
    posts_count::bigint AS total_posts,
    COALESCE(avg_er, 0)::numeric AS avg_engagement_rate,
    COALESCE(avg_reach, 0)::numeric AS avg_reach,
    COALESCE(avg_likes, 0)::numeric AS avg_likes,
    COALESCE(total_inter, 0)::bigint AS total_interactions
  FROM metrics
  ORDER BY avg_engagement_rate DESC NULLS LAST;
$$;

-- Best time-of-day window (em horas BRT). Útil pra "publica entre 18-21h
-- na quarta — gera 2× mais engagement".
CREATE OR REPLACE FUNCTION active.social_report_by_hour(
  p_org_id uuid,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 30
)
RETURNS TABLE (
  hour_of_day integer,
  posts_count bigint,
  avg_engagement_rate numeric,
  avg_reach numeric
)
LANGUAGE sql STABLE AS $$
  WITH metrics AS (
    SELECT
      EXTRACT(HOUR FROM (c.published_at AT TIME ZONE 'America/Sao_Paulo'))::int AS hr,
      COUNT(DISTINCT m.content_id) AS posts_count,
      AVG(m.engagement_rate) AS avg_er,
      AVG(m.reach) AS avg_reach
    FROM active.social_metrics_daily m
    JOIN active.social_contents c ON c.id = m.content_id
    WHERE m.org_id = p_org_id
      AND m.date >= (now()::date - p_since_days)
      AND (p_brand_id IS NULL OR m.brand_id = p_brand_id)
      AND c.published_at IS NOT NULL
    GROUP BY hr
  )
  SELECT
    hr AS hour_of_day,
    posts_count::bigint,
    COALESCE(avg_er, 0)::numeric,
    COALESCE(avg_reach, 0)::numeric
  FROM metrics
  ORDER BY hr ASC;
$$;

-- Top performers: top N posts por engagement_rate (acumulado).
CREATE OR REPLACE FUNCTION active.social_report_top_performers(
  p_org_id uuid,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 30,
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  content_id uuid,
  title text,
  pillar text,
  content_type text,
  cover_image_url text,
  total_reach bigint,
  total_engagement bigint,
  avg_engagement_rate numeric
)
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT
      m.content_id,
      SUM(m.reach) AS total_reach,
      SUM(m.likes + m.comments + m.shares + m.saved) AS total_eng,
      AVG(m.engagement_rate) AS avg_er
    FROM active.social_metrics_daily m
    WHERE m.org_id = p_org_id
      AND m.date >= (now()::date - p_since_days)
      AND (p_brand_id IS NULL OR m.brand_id = p_brand_id)
    GROUP BY m.content_id
  )
  SELECT
    a.content_id,
    c.title,
    c.pillar,
    c.content_type,
    c.cover_image_url,
    COALESCE(a.total_reach, 0)::bigint,
    COALESCE(a.total_eng, 0)::bigint,
    COALESCE(a.avg_er, 0)::numeric
  FROM agg a
  JOIN active.social_contents c ON c.id = a.content_id
  ORDER BY a.avg_er DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

-- Resumo geral: 1 row com totalizadores pra cards do topo.
CREATE OR REPLACE FUNCTION active.social_report_summary(
  p_org_id uuid,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE sql STABLE AS $$
  WITH agg AS (
    SELECT
      COUNT(DISTINCT m.content_id) AS posts_with_metrics,
      SUM(m.reach) AS total_reach,
      SUM(m.impressions) AS total_impressions,
      SUM(m.likes) AS total_likes,
      SUM(m.comments) AS total_comments,
      SUM(m.shares) AS total_shares,
      SUM(m.saved) AS total_saved,
      SUM(m.profile_visits) AS total_profile_visits,
      SUM(m.profile_follows) AS total_profile_follows,
      AVG(m.engagement_rate) AS avg_er
    FROM active.social_metrics_daily m
    WHERE m.org_id = p_org_id
      AND m.date >= (now()::date - p_since_days)
      AND (p_brand_id IS NULL OR m.brand_id = p_brand_id)
  )
  SELECT jsonb_build_object(
    'posts_with_metrics', COALESCE(posts_with_metrics, 0),
    'total_reach', COALESCE(total_reach, 0),
    'total_impressions', COALESCE(total_impressions, 0),
    'total_likes', COALESCE(total_likes, 0),
    'total_comments', COALESCE(total_comments, 0),
    'total_shares', COALESCE(total_shares, 0),
    'total_saved', COALESCE(total_saved, 0),
    'total_profile_visits', COALESCE(total_profile_visits, 0),
    'total_profile_follows', COALESCE(total_profile_follows, 0),
    'avg_engagement_rate', COALESCE(avg_er, 0)
  )
  FROM agg;
$$;

-- ─── 6. Grants ───────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_metrics_daily TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_signals TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.social_report_by_pillar TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.social_report_by_hour TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.social_report_top_performers TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.social_report_summary TO authenticated, service_role;
