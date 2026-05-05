-- ============================================================
-- 047: ad_signals — sinais detectados pelo SignalDetector
-- ============================================================
-- Bloco G do Active Intelligence: cada signal é um achado da IA
-- (regras determinísticas + anomaly + sinais compostos) que merece
-- atenção. Bloco H (Alert Engine) consome `status='pending'` e envia
-- pelos managers configurados.
--
-- signal_type:
--   metric_threshold       — Camada 1 (target manual violado)
--   metric_anomaly         — Camada 2 (desvia > 2σ do baseline)
--   creative_fatigue       — Camada 3 (CTR↓ + freq↑ + CPC↑)
--   audience_burnout       — Camada 3 (freq>4 + CTR cai >30% em 7d)
--   scaling_inefficiency   — Camada 3 (spend dobra mas conversões <50%)
--   pixel_drift            — Camada 3 (conversões caem >50% sem mudar spend)
--   lead_unattended        — Camada 3 (lead de ad sem resposta em >1h)
--
-- dedupe_key — agrupa sinais "iguais" pra evitar spam:
--   formato: "<signal_type>:<campaign_id|account>:<bucket_date>"
--   bucket_date = YYYY-MM-DD (1 sinal por dia daquele tipo+campaign)
--
-- payload — campos específicos por tipo. Permite extender sem migration.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.ad_signals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  integration_id    uuid REFERENCES active.ad_integrations(id) ON DELETE CASCADE,
  campaign_id       uuid REFERENCES active.ad_campaigns(id) ON DELETE CASCADE,
  platform          text NOT NULL CHECK (platform IN ('meta', 'google')),
  signal_type       text NOT NULL,
  /** Métrica que disparou (camadas 1+2). Null pras camadas 3. */
  metric_key        text REFERENCES active.ad_metric_catalog(key) ON DELETE SET NULL,
  severity          text NOT NULL CHECK (severity IN ('warning', 'critical')),
  /** Valor atual da métrica observada quando signal foi gerado. */
  current_value     numeric(14,4),
  /** Valor de threshold (target manual ou baseline + Nσ). */
  threshold_value   numeric(14,4),
  /** Payload livre — context-specific por signal_type. */
  payload           jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Chave de dedupe — combina signal_type + campaign + bucket diário. */
  dedupe_key        text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'acked', 'expired')),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  sent_at           timestamptz,
  ack_at            timestamptz,
  /** User que fez ack (se aplicável) */
  acked_by          uuid
);

-- Dedupe: 1 sinal pendente por dedupe_key. Quando já existe sent/acked,
-- pode criar novo (são "incidentes" diferentes do mesmo padrão).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ad_signals_pending_dedupe
  ON active.ad_signals (org_id, dedupe_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ad_signals_org_status
  ON active.ad_signals (org_id, status, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_signals_campaign
  ON active.ad_signals (campaign_id, generated_at DESC);

-- Worker do Alert Engine (Bloco H) lê pendentes mais recentes
CREATE INDEX IF NOT EXISTS idx_ad_signals_pending_recent
  ON active.ad_signals (org_id, generated_at DESC)
  WHERE status = 'pending';

ALTER TABLE active.ad_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.ad_signals;
CREATE POLICY "org_isolation" ON active.ad_signals
  FOR ALL USING (org_id = active.get_user_org_id());

COMMENT ON TABLE active.ad_signals IS
  'Sinais detectados pelas 3 camadas do SignalDetector. dedupe_key garante 1 pendente/dia/campaign/tipo.';
