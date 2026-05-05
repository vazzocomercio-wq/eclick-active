-- ============================================================
-- 049: alert_routing_rules — quem recebe qual signal
-- ============================================================
-- Bloco H do Active Intelligence: define regras tipo "marketer recebe
-- creative_fatigue+critical, dono recebe scaling_inefficiency"
--
-- signal_type: ex 'creative_fatigue', 'metric_threshold', 'pixel_drift'.
--              '*' = catch-all (qualquer signal_type bate).
-- min_severity:
--   warning  — encaminha warning E critical
--   critical — só encaminha critical
-- delivery_mode:
--   immediate — manda assim que detectar (5min tick)
--   digest_8h, digest_14h, digest_18h — agrupa e manda no horário
--   weekly    — segunda 8h, resumo semanal consolidado
-- business_hours_only:
--   Quando true, só dispara entre 8h-20h tz da org. Fora disso,
--   acumula como digest no próximo slot.
-- ============================================================

CREATE TABLE IF NOT EXISTS active.alert_routing_rules (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  /** Nome opcional pra UI mostrar ("Alertas críticos pro dono"). */
  name                  text,
  /** Filtro signal_type. '*' = todos. */
  signal_type           text NOT NULL DEFAULT '*',
  min_severity          text NOT NULL DEFAULT 'warning'
    CHECK (min_severity IN ('warning', 'critical')),
  /** Manager(s) que recebem. Vazio = aborta delivery (rule sem destino). */
  manager_ids           uuid[] NOT NULL DEFAULT '{}'::uuid[],
  delivery_mode         text NOT NULL DEFAULT 'immediate'
    CHECK (delivery_mode IN ('immediate', 'digest_8h', 'digest_14h', 'digest_18h', 'weekly')),
  business_hours_only   boolean NOT NULL DEFAULT false,
  enabled               boolean NOT NULL DEFAULT true,
  /** Prioridade — quando 2+ rules batem, a de menor número vence (1=top). */
  priority              int NOT NULL DEFAULT 100,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alert_routing_rules_org_enabled
  ON active.alert_routing_rules (org_id, enabled, priority);

ALTER TABLE active.alert_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.alert_routing_rules;
CREATE POLICY "org_isolation" ON active.alert_routing_rules
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_alert_routing_rules_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_alert_routing_rules_updated_at ON active.alert_routing_rules;
CREATE TRIGGER tg_alert_routing_rules_updated_at
  BEFORE UPDATE ON active.alert_routing_rules
  FOR EACH ROW EXECUTE FUNCTION active.tg_alert_routing_rules_updated_at();

COMMENT ON TABLE active.alert_routing_rules IS
  'Routing rules: signal_type+severity → manager_ids[] → delivery_mode';
