-- ═══════════════════════════════════════════════════
-- 053: SAC Tickets — camada sobre conversations
-- Tickets, actions (timeline), SLA rules, templates.
-- Funciona standalone E enriquecido com bridge SaaS (M052).
-- ═══════════════════════════════════════════════════

-- ─── 1. sac_tickets ──────────────────────────────
CREATE TABLE active.sac_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  contact_id uuid NOT NULL REFERENCES active.contacts(id) ON DELETE CASCADE,
  ticket_number integer NOT NULL,

  -- Classificação
  category text NOT NULL DEFAULT 'general' CHECK (category IN (
    'pre_sale','post_sale','order_status','delivery_delay',
    'exchange','return','warranty','cancellation','refund',
    'defective_product','wrong_product','missing_parts',
    'invoice','payment','technical','complaint','mediation',
    'negative_review','general'
  )),
  subcategory text,

  status text NOT NULL DEFAULT 'new' CHECK (status IN (
    'new','in_progress','waiting_customer','waiting_internal',
    'resolved','reopened','cancelled'
  )),

  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN (
    'low','normal','high','critical','reputation_risk'
  )),
  reputation_risk_level text NOT NULL DEFAULT 'none' CHECK (reputation_risk_level IN (
    'none','low','medium','high','critical'
  )),

  -- SLA
  sla_deadline_at timestamptz,
  sla_first_response_at timestamptz,
  sla_resolved_at timestamptz,
  sla_breached boolean NOT NULL DEFAULT false,

  -- Atribuição
  assigned_to uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  escalated_to uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  department text CHECK (department IN ('sales','support','logistics','finance','management')),

  -- Pedido (bridge SaaS — opcional)
  order_id text,
  order_marketplace text,
  order_marketplace_id text,
  order_status text,
  order_tracking text,
  order_value numeric(12,2),
  order_data jsonb,

  -- IA
  ai_category text,
  ai_priority text,
  ai_sentiment text CHECK (ai_sentiment IN ('positive','neutral','frustrated','angry','very_angry')),
  ai_risk_score integer DEFAULT 0 CHECK (ai_risk_score BETWEEN 0 AND 100),
  ai_suggested_response text,
  ai_summary text,
  ai_resolution_suggestion text,
  ai_classified_at timestamptz,

  -- Resolução
  resolution_type text CHECK (resolution_type IN (
    'resolved','refunded','exchanged','returned','cancelled',
    'escalated','no_action_needed','duplicate'
  )),
  resolution_notes text,
  customer_satisfaction integer CHECK (customer_satisfaction BETWEEN 1 AND 5),

  tags text[] NOT NULL DEFAULT '{}',
  source_channel text,
  is_preventive boolean NOT NULL DEFAULT false,
  created_by_ai boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  reopened_at timestamptz,
  first_response_at timestamptz,

  UNIQUE (org_id, ticket_number)
);

CREATE INDEX idx_sac_tickets_org ON active.sac_tickets(org_id);
CREATE INDEX idx_sac_tickets_org_status ON active.sac_tickets(org_id, status);
CREATE INDEX idx_sac_tickets_org_priority ON active.sac_tickets(org_id, priority);
CREATE INDEX idx_sac_tickets_org_category ON active.sac_tickets(org_id, category);
CREATE INDEX idx_sac_tickets_contact ON active.sac_tickets(contact_id);
CREATE INDEX idx_sac_tickets_conversation ON active.sac_tickets(conversation_id);
CREATE INDEX idx_sac_tickets_assigned ON active.sac_tickets(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX idx_sac_tickets_sla_pending ON active.sac_tickets(org_id, sla_deadline_at)
  WHERE sla_breached = false AND status NOT IN ('resolved','cancelled');
CREATE INDEX idx_sac_tickets_order ON active.sac_tickets(org_id, order_marketplace_id)
  WHERE order_marketplace_id IS NOT NULL;
CREATE INDEX idx_sac_tickets_preventive ON active.sac_tickets(org_id) WHERE is_preventive = true;
CREATE INDEX idx_sac_tickets_created ON active.sac_tickets(org_id, created_at DESC);

CREATE TRIGGER trg_sac_tickets_updated_at
  BEFORE UPDATE ON active.sac_tickets
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. sac_ticket_actions (timeline) ────────────
CREATE TABLE active.sac_ticket_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES active.sac_tickets(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  action_type text NOT NULL CHECK (action_type IN (
    'created','status_changed','priority_changed','category_changed',
    'assigned','escalated','note_added','response_sent','order_linked',
    'order_checked','logistics_contacted','refund_initiated','exchange_initiated',
    'sla_breached','reopened','resolved','ai_classified','ai_suggested',
    'preventive_created','customer_rated'
  )),
  actor_type text NOT NULL DEFAULT 'agent' CHECK (actor_type IN ('agent','system','ai','customer')),
  actor_id uuid,
  description text,
  old_value text,
  new_value text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sac_actions_ticket ON active.sac_ticket_actions(ticket_id, created_at DESC);
CREATE INDEX idx_sac_actions_org ON active.sac_ticket_actions(org_id, created_at DESC);
CREATE INDEX idx_sac_actions_type ON active.sac_ticket_actions(org_id, action_type);

-- ─── 3. sac_sla_rules ────────────────────────────
CREATE TABLE active.sac_sla_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel_type text,
  category text,
  priority text,
  first_response_minutes integer NOT NULL DEFAULT 60,
  resolution_minutes integer NOT NULL DEFAULT 480,
  business_hours_only boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  -- Score de especificidade: priority(4) > category(2) > channel(1).
  -- Ordenamos DESC pra pegar a regra mais específica que casar.
  specificity_score integer GENERATED ALWAYS AS (
    (CASE WHEN priority IS NOT NULL THEN 4 ELSE 0 END) +
    (CASE WHEN category IS NOT NULL THEN 2 ELSE 0 END) +
    (CASE WHEN channel_type IS NOT NULL THEN 1 ELSE 0 END)
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sac_sla_rules_org ON active.sac_sla_rules(org_id, is_active);
CREATE INDEX idx_sac_sla_rules_match ON active.sac_sla_rules(org_id, specificity_score DESC)
  WHERE is_active = true;

CREATE TRIGGER trg_sac_sla_rules_updated_at
  BEFORE UPDATE ON active.sac_sla_rules
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 4. sac_response_templates ───────────────────
CREATE TABLE active.sac_response_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  content text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  usage_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sac_templates_org ON active.sac_response_templates(org_id, category)
  WHERE is_active = true;

CREATE TRIGGER trg_sac_templates_updated_at
  BEFORE UPDATE ON active.sac_response_templates
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 5. RLS policies ─────────────────────────────
ALTER TABLE active.sac_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.sac_ticket_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.sac_sla_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.sac_response_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sac_tickets_org_isolation" ON active.sac_tickets
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "sac_actions_org_isolation" ON active.sac_ticket_actions
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "sac_sla_org_isolation" ON active.sac_sla_rules
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "sac_templates_org_isolation" ON active.sac_response_templates
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 6. Realtime ─────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.sac_tickets;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.sac_ticket_actions;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE active.sac_tickets REPLICA IDENTITY FULL;

-- ─── 7. Trigger: ticket_number sequencial por org ─
-- Auto-increment local por org. Um número não-nulo passado pelo cliente
-- é respeitado (seed/migrations); nulo ou zero → calculado.
CREATE OR REPLACE FUNCTION active.sac_set_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = 0 THEN
    SELECT COALESCE(MAX(ticket_number), 0) + 1
      INTO NEW.ticket_number
      FROM active.sac_tickets
      WHERE org_id = NEW.org_id;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_sac_set_ticket_number
  BEFORE INSERT ON active.sac_tickets
  FOR EACH ROW EXECUTE FUNCTION active.sac_set_ticket_number();

-- ─── 8. Trigger: auto-log de ações ───────────────
-- Toda mudança relevante vira linha em sac_ticket_actions automaticamente.
-- Service não precisa logar manualmente (exceto note_added que é insert direto).
CREATE OR REPLACE FUNCTION active.sac_log_ticket_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, description, new_value
    ) VALUES (
      NEW.id, NEW.org_id, 'created',
      CASE WHEN NEW.created_by_ai THEN 'ai' ELSE 'agent' END,
      v_actor,
      CASE WHEN NEW.is_preventive THEN 'Ticket preventivo criado' ELSE 'Ticket criado' END,
      NEW.category
    );
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, old_value, new_value
    ) VALUES (NEW.id, NEW.org_id, 'status_changed', 'agent', v_actor, OLD.status, NEW.status);
  END IF;

  IF NEW.priority IS DISTINCT FROM OLD.priority THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, old_value, new_value
    ) VALUES (NEW.id, NEW.org_id, 'priority_changed', 'agent', v_actor, OLD.priority, NEW.priority);
  END IF;

  IF NEW.category IS DISTINCT FROM OLD.category THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, old_value, new_value
    ) VALUES (NEW.id, NEW.org_id, 'category_changed', 'agent', v_actor, OLD.category, NEW.category);
  END IF;

  IF NEW.assigned_to IS DISTINCT FROM OLD.assigned_to THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, old_value, new_value
    ) VALUES (NEW.id, NEW.org_id, 'assigned', 'agent', v_actor,
      OLD.assigned_to::text, NEW.assigned_to::text);
  END IF;

  IF NEW.escalated_to IS DISTINCT FROM OLD.escalated_to AND NEW.escalated_to IS NOT NULL THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, new_value
    ) VALUES (NEW.id, NEW.org_id, 'escalated', 'agent', v_actor, NEW.escalated_to::text);
  END IF;

  IF NEW.sla_breached = true AND OLD.sla_breached = false THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, description
    ) VALUES (NEW.id, NEW.org_id, 'sla_breached', 'system', 'SLA violado');
  END IF;

  IF NEW.status = 'resolved' AND OLD.status <> 'resolved' THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, description, new_value
    ) VALUES (NEW.id, NEW.org_id, 'resolved', 'agent', v_actor,
      coalesce(NEW.resolution_notes, ''), NEW.resolution_type);
  END IF;

  IF NEW.status = 'reopened' AND OLD.status <> 'reopened' THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, description
    ) VALUES (NEW.id, NEW.org_id, 'reopened', 'agent', v_actor, 'Ticket reaberto');
  END IF;

  IF NEW.order_id IS DISTINCT FROM OLD.order_id AND NEW.order_id IS NOT NULL THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, actor_id, new_value
    ) VALUES (NEW.id, NEW.org_id, 'order_linked', 'agent', v_actor, NEW.order_id);
  END IF;

  IF NEW.customer_satisfaction IS DISTINCT FROM OLD.customer_satisfaction
    AND NEW.customer_satisfaction IS NOT NULL THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, new_value
    ) VALUES (NEW.id, NEW.org_id, 'customer_rated', 'customer', NEW.customer_satisfaction::text);
  END IF;

  IF NEW.ai_classified_at IS DISTINCT FROM OLD.ai_classified_at
    AND NEW.ai_classified_at IS NOT NULL THEN
    INSERT INTO active.sac_ticket_actions (
      ticket_id, org_id, action_type, actor_type, description, new_value
    ) VALUES (NEW.id, NEW.org_id, 'ai_classified', 'ai',
      coalesce(NEW.ai_summary, ''), NEW.ai_priority);
  END IF;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_sac_log_changes
  AFTER INSERT OR UPDATE ON active.sac_tickets
  FOR EACH ROW EXECUTE FUNCTION active.sac_log_ticket_changes();

-- ─── 9. RPC: detectar SLA breach (chamado por worker) ──
CREATE OR REPLACE FUNCTION active.sac_check_sla_breaches()
RETURNS TABLE (ticket_id uuid, org_id uuid)
LANGUAGE sql AS $$
  WITH breached AS (
    UPDATE active.sac_tickets
    SET sla_breached = true
    WHERE sla_breached = false
      AND status NOT IN ('resolved','cancelled')
      AND sla_deadline_at IS NOT NULL
      AND sla_deadline_at < now()
    RETURNING id, org_id
  )
  SELECT id AS ticket_id, org_id FROM breached;
$$;

-- ─── 10. RPC: Dashboard counts (perf) ────────────
CREATE OR REPLACE FUNCTION active.sac_dashboard_counts(p_org_id uuid)
RETURNS jsonb LANGUAGE sql STABLE AS $$
  SELECT jsonb_build_object(
    'new', COUNT(*) FILTER (WHERE status = 'new'),
    'in_progress', COUNT(*) FILTER (WHERE status = 'in_progress'),
    'waiting_customer', COUNT(*) FILTER (WHERE status = 'waiting_customer'),
    'waiting_internal', COUNT(*) FILTER (WHERE status = 'waiting_internal'),
    'resolved', COUNT(*) FILTER (WHERE status = 'resolved'),
    'critical', COUNT(*) FILTER (WHERE priority IN ('critical','reputation_risk') AND status NOT IN ('resolved','cancelled')),
    'sla_due_soon', COUNT(*) FILTER (
      WHERE sla_breached = false
        AND status NOT IN ('resolved','cancelled')
        AND sla_deadline_at IS NOT NULL
        AND sla_deadline_at BETWEEN now() AND now() + interval '1 hour'
    ),
    'sla_breached', COUNT(*) FILTER (
      WHERE sla_breached = true AND status NOT IN ('resolved','cancelled')
    ),
    'reputation_risk', COUNT(*) FILTER (
      WHERE reputation_risk_level IN ('high','critical') AND status NOT IN ('resolved','cancelled')
    ),
    'resolved_today', COUNT(*) FILTER (
      WHERE status = 'resolved'
        AND resolved_at >= date_trunc('day', now())
    ),
    'total_open', COUNT(*) FILTER (WHERE status NOT IN ('resolved','cancelled'))
  )
  FROM active.sac_tickets
  WHERE org_id = p_org_id;
$$;

-- ─── 11. Seed SLA padrão por org ─────────────────
CREATE OR REPLACE FUNCTION active.sac_seed_default_sla(p_org_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO active.sac_sla_rules (org_id, name, priority, first_response_minutes, resolution_minutes, business_hours_only)
  SELECT p_org_id, 'Crítico — 15min/2h', 'critical', 15, 120, false
  WHERE NOT EXISTS (
    SELECT 1 FROM active.sac_sla_rules WHERE org_id = p_org_id AND priority = 'critical' AND category IS NULL AND channel_type IS NULL
  );

  INSERT INTO active.sac_sla_rules (org_id, name, priority, first_response_minutes, resolution_minutes, business_hours_only)
  SELECT p_org_id, 'Risco reputacional — 10min/1h', 'reputation_risk', 10, 60, false
  WHERE NOT EXISTS (
    SELECT 1 FROM active.sac_sla_rules WHERE org_id = p_org_id AND priority = 'reputation_risk' AND category IS NULL AND channel_type IS NULL
  );

  INSERT INTO active.sac_sla_rules (org_id, name, priority, first_response_minutes, resolution_minutes, business_hours_only)
  SELECT p_org_id, 'Alto — 30min/4h', 'high', 30, 240, true
  WHERE NOT EXISTS (
    SELECT 1 FROM active.sac_sla_rules WHERE org_id = p_org_id AND priority = 'high' AND category IS NULL AND channel_type IS NULL
  );

  INSERT INTO active.sac_sla_rules (org_id, name, priority, first_response_minutes, resolution_minutes, business_hours_only)
  SELECT p_org_id, 'Normal — 1h/8h', 'normal', 60, 480, true
  WHERE NOT EXISTS (
    SELECT 1 FROM active.sac_sla_rules WHERE org_id = p_org_id AND priority = 'normal' AND category IS NULL AND channel_type IS NULL
  );

  INSERT INTO active.sac_sla_rules (org_id, name, priority, first_response_minutes, resolution_minutes, business_hours_only)
  SELECT p_org_id, 'Baixo — 4h/24h', 'low', 240, 1440, true
  WHERE NOT EXISTS (
    SELECT 1 FROM active.sac_sla_rules WHERE org_id = p_org_id AND priority = 'low' AND category IS NULL AND channel_type IS NULL
  );
END $$;

-- Aplica SLA padrão em todas as orgs existentes
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM active.organizations LOOP
    PERFORM active.sac_seed_default_sla(r.id);
  END LOOP;
END $$;

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON active.sac_tickets TO authenticated, service_role;
GRANT SELECT, INSERT ON active.sac_ticket_actions TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.sac_sla_rules TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.sac_response_templates TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.sac_check_sla_breaches TO service_role;
GRANT EXECUTE ON FUNCTION active.sac_seed_default_sla TO service_role;
GRANT EXECUTE ON FUNCTION active.sac_dashboard_counts TO authenticated, service_role;
