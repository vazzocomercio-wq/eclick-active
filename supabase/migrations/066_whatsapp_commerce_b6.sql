-- ═══════════════════════════════════════════════════
-- 066: WhatsApp Commerce — B6 (Pós-venda + timeline)
-- Tabela de eventos por pedido + trigger pra logar
-- transições de status automaticamente.
-- ═══════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1) whatsapp_order_events — timeline de cada pedido
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.whatsapp_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES active.whatsapp_orders(id) ON DELETE CASCADE,
  /**
   * Tipo do evento. Convenções:
   *   - status:<value> — transição de active.whatsapp_orders.status
   *   - payment:<value> — transição de payment_status
   *   - shipping:<value> — transição de shipping_status
   *   - message:<kind> — comunicação (order_update, tracking, review, reorder, manual)
   *   - automation:<id> — execução de automation
   *   - note — anotação manual
   */
  event_type text NOT NULL,
  description text,
  /**
   * Quem disparou: 'system' (trigger SQL), 'automation', 'agent', 'ai',
   * 'customer', 'webhook'.
   */
  actor_type text NOT NULL DEFAULT 'system',
  actor_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_order_events_order
  ON active.whatsapp_order_events(order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_order_events_org
  ON active.whatsapp_order_events(org_id, created_at DESC);

ALTER TABLE active.whatsapp_order_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_order_events_org" ON active.whatsapp_order_events
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT ON active.whatsapp_order_events
  TO authenticated, service_role;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.whatsapp_order_events;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ────────────────────────────────────────────────────────────
-- 2) Trigger: auto-loga transições de status do pedido
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION active.wa_orders_log_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- INSERT inicial → registra criação
  IF TG_OP = 'INSERT' THEN
    INSERT INTO active.whatsapp_order_events (
      org_id, order_id, event_type, description, actor_type
    ) VALUES (
      NEW.org_id,
      NEW.id,
      'status:' || NEW.status,
      'Pedido ' || NEW.display_number || ' criado',
      'system'
    );
    RETURN NEW;
  END IF;

  -- UPDATE → registra apenas transições reais
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO active.whatsapp_order_events (
      org_id, order_id, event_type, description, actor_type, metadata
    ) VALUES (
      NEW.org_id,
      NEW.id,
      'status:' || NEW.status,
      'Status: ' || COALESCE(OLD.status, 'null') || ' → ' || NEW.status,
      'system',
      jsonb_build_object('from', OLD.status, 'to', NEW.status)
    );
  END IF;

  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
    INSERT INTO active.whatsapp_order_events (
      org_id, order_id, event_type, description, actor_type, metadata
    ) VALUES (
      NEW.org_id,
      NEW.id,
      'payment:' || NEW.payment_status,
      'Pagamento: ' || COALESCE(OLD.payment_status, 'null')
        || ' → ' || NEW.payment_status,
      'system',
      jsonb_build_object('from', OLD.payment_status, 'to', NEW.payment_status)
    );
  END IF;

  IF NEW.shipping_status IS DISTINCT FROM OLD.shipping_status THEN
    INSERT INTO active.whatsapp_order_events (
      org_id, order_id, event_type, description, actor_type, metadata
    ) VALUES (
      NEW.org_id,
      NEW.id,
      'shipping:' || NEW.shipping_status,
      'Envio: ' || COALESCE(OLD.shipping_status, 'null')
        || ' → ' || NEW.shipping_status,
      'system',
      jsonb_build_object(
        'from', OLD.shipping_status,
        'to', NEW.shipping_status,
        'tracking_code', NEW.tracking_code,
        'tracking_url', NEW.tracking_url
      )
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_wa_orders_log_event ON active.whatsapp_orders;
CREATE TRIGGER trg_wa_orders_log_event
  AFTER INSERT OR UPDATE
  ON active.whatsapp_orders
  FOR EACH ROW
  EXECUTE FUNCTION active.wa_orders_log_event();

COMMENT ON TRIGGER trg_wa_orders_log_event ON active.whatsapp_orders IS
  'Auto-loga transições de status/payment_status/shipping_status em whatsapp_order_events.';

-- ────────────────────────────────────────────────────────────
-- 3) Backfill: cria evento "criado" pra pedidos existentes que não têm
-- ────────────────────────────────────────────────────────────

INSERT INTO active.whatsapp_order_events (org_id, order_id, event_type, description, actor_type, created_at)
SELECT
  o.org_id,
  o.id,
  'status:' || o.status,
  'Pedido ' || o.display_number || ' criado (backfill)',
  'system',
  o.created_at
FROM active.whatsapp_orders o
WHERE NOT EXISTS (
  SELECT 1
  FROM active.whatsapp_order_events e
  WHERE e.order_id = o.id
);
