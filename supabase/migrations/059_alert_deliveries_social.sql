-- ═══════════════════════════════════════════════════
-- 059: Estende alert_deliveries pra suportar social_signals
-- (além de ad_signals que já existe).
-- ═══════════════════════════════════════════════════

-- Nova coluna nullable apontando pra social_signals (o signal_id
-- existente continua apontando pra ad_signals — ambos podem co-existir
-- numa mesma row, mas pra alerts gerados pelo social usamos só o novo).
ALTER TABLE active.alert_deliveries
  ADD COLUMN IF NOT EXISTS social_signal_id uuid
    REFERENCES active.social_signals(id) ON DELETE SET NULL;

-- Source identifier — 'ad' (default) | 'social' — facilita queries
-- analíticas e filtros sem precisar JOIN pra descobrir.
ALTER TABLE active.alert_deliveries
  ADD COLUMN IF NOT EXISTS signal_source text NOT NULL DEFAULT 'ad'
    CHECK (signal_source IN ('ad', 'social'));

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_social_signal
  ON active.alert_deliveries(social_signal_id)
  WHERE social_signal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_alert_deliveries_source
  ON active.alert_deliveries(org_id, signal_source, status);
