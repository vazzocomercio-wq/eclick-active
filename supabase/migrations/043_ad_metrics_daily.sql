-- ============================================================
-- 043: ad_metrics_daily — métricas diárias por campaign (particionada)
-- ============================================================
-- Bloco C do Active Intelligence: insights de campanhas armazenadas
-- em granularidade diária. Particionada por mês (mesmo padrão de
-- messages e ai_interactions) — volume cresce ~30 rows/campaign/mês,
-- e várias orgs com várias campaigns chega rápido em centenas de mil.
--
-- Métricas no MVP: spend, impressions, clicks, ctr, cpc, cpm,
-- conversions, cost_per_conversion, roas. raw_metrics guarda payload
-- completo do Meta/Google pra features futuras (frequency, reach,
-- video_avg_play_time, etc.) sem precisar nova migration.
--
-- Granularidade campaign-level no MVP. adset/ad fica Fase 2.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_metrics_daily (
  id                   uuid NOT NULL DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL,
  campaign_id          uuid NOT NULL,
  integration_id       uuid NOT NULL,
  platform             text NOT NULL CHECK (platform IN ('meta', 'google')),
  date                 date NOT NULL,
  /** Em USD (convertido pelo connector se a conta for em outra moeda). */
  spend                numeric(12,2) NOT NULL DEFAULT 0,
  impressions          bigint NOT NULL DEFAULT 0,
  clicks               bigint NOT NULL DEFAULT 0,
  ctr                  numeric(8,4) NOT NULL DEFAULT 0,  -- 0.0123 = 1.23%
  cpc                  numeric(10,4) NOT NULL DEFAULT 0,
  cpm                  numeric(10,4) NOT NULL DEFAULT 0,
  conversions          numeric(10,2) NOT NULL DEFAULT 0,
  cost_per_conversion  numeric(10,2) NOT NULL DEFAULT 0,
  roas                 numeric(10,4) NOT NULL DEFAULT 0,
  /** Payload bruto pra extender métricas no futuro sem migration. */
  raw_metrics          jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- PK precisa incluir a coluna de particionamento (regra Postgres)
  PRIMARY KEY (id, date)
) PARTITION BY RANGE (date);

-- Cria partições mensais cobrindo até 12 meses futuros (mesmo pattern
-- de messages/ai_interactions). Em prod, um cron deve criar a próxima
-- partição automaticamente — pra MVP, manualmente se precisar.
DO $$
DECLARE
  start_date date := '2026-01-01';
  partition_date date;
  partition_name text;
  next_date date;
BEGIN
  FOR i IN 0..23 LOOP  -- 24 meses (Jan 2026 → Dec 2027)
    partition_date := start_date + (i || ' months')::interval;
    next_date := partition_date + interval '1 month';
    partition_name := 'ad_metrics_daily_' || to_char(partition_date, 'YYYY_MM');

    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS active.%I PARTITION OF active.ad_metrics_daily
       FOR VALUES FROM (%L) TO (%L)',
      partition_name,
      partition_date,
      next_date
    );
  END LOOP;
END $$;

-- Default partition pra rows fora dos ranges previstos (deve ficar vazia)
CREATE TABLE IF NOT EXISTS active.ad_metrics_daily_default
  PARTITION OF active.ad_metrics_daily DEFAULT;

-- Índices em todas as partições (regra Postgres: índices da master table
-- viram índices em cada partição automaticamente)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_metrics_daily_campaign_date
  ON active.ad_metrics_daily (campaign_id, date);

CREATE INDEX IF NOT EXISTS idx_ad_metrics_daily_org_date
  ON active.ad_metrics_daily (org_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_ad_metrics_daily_integration_date
  ON active.ad_metrics_daily (integration_id, date DESC);

ALTER TABLE active.ad_metrics_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_metrics_daily;
CREATE POLICY "org_isolation" ON active.ad_metrics_daily
  FOR ALL USING (org_id = active.get_user_org_id());

COMMENT ON TABLE active.ad_metrics_daily IS
  'Métricas diárias por campaign. PARTITION BY RANGE (date) mensal. CASCADE FK não funciona — deletar manualmente antes do parent (mesmo gotcha do messages/ai_interactions).';
