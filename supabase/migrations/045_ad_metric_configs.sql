-- ============================================================
-- 045: ad_metric_configs — config de monitoramento por org+métrica
-- ============================================================
-- Bloco E do Active Intelligence: cada org escolhe quais métricas do
-- catálogo (044) monitorar e com quais thresholds. Quando ausente,
-- defaults virtuais opinionados são retornados pra UI (ROAS, CPA,
-- CTR, Frequency, Spend etc. todos enabled=true com sugestões).
--
-- threshold_mode:
--   manual — user define target_value (e warning/critical pct)
--   auto   — sistema calcula baseline rolling (média ± 2σ) com
--            baseline_window_days
--
-- aggregation_window:
--   day   — avalia métrica do dia mais recente
--   7d    — agrega últimos 7 dias (sum/avg conforme catalog.aggregation)
--   30d   — últimos 30 dias
--
-- routing_manager_ids[]: opcional — quem recebe alerta dessa métrica.
-- Bloco H define alert_managers; vazio = todos os managers da org.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_metric_configs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  metric_key            text NOT NULL REFERENCES active.ad_metric_catalog(key) ON DELETE CASCADE,
  enabled               boolean NOT NULL DEFAULT true,
  threshold_mode        text NOT NULL DEFAULT 'manual'
    CHECK (threshold_mode IN ('manual', 'auto')),
  /** Valor-alvo manual. Só relevante quando threshold_mode='manual'. */
  target_value          numeric(14,4),
  /** Pct de variação que dispara warning (default 15%) */
  warning_pct           numeric(5,2) NOT NULL DEFAULT 15,
  /** Pct de variação que dispara critical (default 30%) */
  critical_pct          numeric(5,2) NOT NULL DEFAULT 30,
  /** Janela pra calcular baseline em modo 'auto' (default 30 dias) */
  baseline_window_days  int NOT NULL DEFAULT 30,
  aggregation_window    text NOT NULL DEFAULT 'day'
    CHECK (aggregation_window IN ('day', '7d', '30d')),
  /** UUIDs de alert_managers da org (Bloco H). Vazio = broadcast pros managers default. */
  routing_manager_ids   uuid[] NOT NULL DEFAULT '{}'::uuid[],
  /** Notas livres do user pra contexto futuro */
  notes                 text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- 1 config por (org, metric)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_metric_configs_org_metric
  ON active.ad_metric_configs (org_id, metric_key);

CREATE INDEX IF NOT EXISTS idx_ad_metric_configs_org_enabled
  ON active.ad_metric_configs (org_id, enabled);

ALTER TABLE active.ad_metric_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_metric_configs;
CREATE POLICY "org_isolation" ON active.ad_metric_configs
  FOR ALL USING (org_id = active.get_user_org_id());

-- Trigger updated_at
CREATE OR REPLACE FUNCTION active.tg_ad_metric_configs_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_ad_metric_configs_updated_at ON active.ad_metric_configs;
CREATE TRIGGER tg_ad_metric_configs_updated_at
  BEFORE UPDATE ON active.ad_metric_configs
  FOR EACH ROW EXECUTE FUNCTION active.tg_ad_metric_configs_updated_at();

COMMENT ON TABLE active.ad_metric_configs IS
  'Config de monitoramento por org+métrica. Defaults virtuais quando ausente.';
