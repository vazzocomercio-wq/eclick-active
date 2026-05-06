-- ═══════════════════════════════════════════════════
-- 058: Social Hashtag Analytics
-- Agregação por hashtag: total_uses, avg_reach,
-- avg_engagement_rate, total_interactions. Não precisa
-- tabela nova — calcula on-the-fly via RPC unnesting o
-- array hashtags de social_contents JOIN com metrics.
-- ═══════════════════════════════════════════════════

-- Top hashtags por engagement_rate médio (proxy do que mais funciona)
CREATE OR REPLACE FUNCTION active.social_hashtag_top(
  p_org_id uuid,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 60,
  p_limit integer DEFAULT 20,
  p_min_uses integer DEFAULT 2
)
RETURNS TABLE (
  hashtag text,
  total_uses bigint,
  avg_engagement_rate numeric,
  avg_reach numeric,
  avg_likes numeric,
  total_interactions bigint
)
LANGUAGE sql STABLE AS $$
  WITH unnested AS (
    SELECT
      lower(trim(both '#' from h)) AS hashtag,
      m.engagement_rate,
      m.reach,
      m.likes,
      m.likes + m.comments + m.shares + m.saved AS interactions
    FROM active.social_contents c
    JOIN active.social_metrics_daily m ON m.content_id = c.id
    CROSS JOIN LATERAL unnest(c.hashtags) AS h
    WHERE c.org_id = p_org_id
      AND m.date >= (now()::date - p_since_days)
      AND (p_brand_id IS NULL OR c.brand_id = p_brand_id)
      AND h IS NOT NULL
      AND length(trim(both '#' from h)) > 1
  ),
  agg AS (
    SELECT
      hashtag,
      COUNT(*) AS uses,
      AVG(engagement_rate) AS avg_er,
      AVG(reach) AS avg_reach,
      AVG(likes) AS avg_likes,
      SUM(interactions) AS total_inter
    FROM unnested
    GROUP BY hashtag
    HAVING COUNT(*) >= GREATEST(p_min_uses, 1)
  )
  SELECT
    hashtag,
    uses::bigint AS total_uses,
    COALESCE(avg_er, 0)::numeric AS avg_engagement_rate,
    COALESCE(avg_reach, 0)::numeric AS avg_reach,
    COALESCE(avg_likes, 0)::numeric AS avg_likes,
    COALESCE(total_inter, 0)::bigint AS total_interactions
  FROM agg
  ORDER BY avg_engagement_rate DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

-- Stats de uma hashtag específica (drill-down)
CREATE OR REPLACE FUNCTION active.social_hashtag_detail(
  p_org_id uuid,
  p_hashtag text,
  p_brand_id uuid DEFAULT NULL,
  p_since_days integer DEFAULT 60
)
RETURNS TABLE (
  content_id uuid,
  title text,
  pillar text,
  cover_image_url text,
  engagement_rate numeric,
  reach bigint,
  total_interactions bigint,
  published_at timestamptz
)
LANGUAGE sql STABLE AS $$
  WITH normalized_target AS (
    SELECT lower(trim(both '#' from p_hashtag)) AS h
  )
  SELECT DISTINCT ON (c.id)
    c.id AS content_id,
    c.title,
    c.pillar,
    c.cover_image_url,
    COALESCE(m.engagement_rate, 0)::numeric AS engagement_rate,
    COALESCE(m.reach, 0)::bigint AS reach,
    COALESCE(m.likes + m.comments + m.shares + m.saved, 0)::bigint AS total_interactions,
    c.published_at
  FROM active.social_contents c
  JOIN active.social_metrics_daily m ON m.content_id = c.id
  CROSS JOIN normalized_target nt
  WHERE c.org_id = p_org_id
    AND (p_brand_id IS NULL OR c.brand_id = p_brand_id)
    AND m.date >= (now()::date - p_since_days)
    AND EXISTS (
      SELECT 1 FROM unnest(c.hashtags) AS h
      WHERE lower(trim(both '#' from h)) = nt.h
    )
  ORDER BY c.id, m.date DESC
  LIMIT 50;
$$;

-- Grants
GRANT EXECUTE ON FUNCTION active.social_hashtag_top TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.social_hashtag_detail TO authenticated, service_role;
