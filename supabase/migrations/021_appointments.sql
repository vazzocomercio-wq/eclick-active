-- ============================================================
-- 021: Agendamento inteligente — appointments + types + availability
-- ============================================================
-- Esquema de agendamentos paralelo às tasks. Tasks são "pra fazer X até
-- prazo Y"; appointments são "compromisso com cliente em horário fixo Y".
-- Compartilham a UI de calendário mas têm semântica e ciclo de vida
-- diferentes (lembretes 24h/1h, no-show detection, integração externa).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. appointment_types — tipos configuráveis por org
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.appointment_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  duration_minutes integer NOT NULL DEFAULT 30 CHECK (duration_minutes > 0),
  location_type text NOT NULL DEFAULT 'online'
    CHECK (location_type IN ('online', 'presencial', 'telefone', 'flexivel')),
  location_details text,
  color text NOT NULL DEFAULT '#00E5FF',
  buffer_minutes integer NOT NULL DEFAULT 15 CHECK (buffer_minutes >= 0),
  min_advance_hours integer NOT NULL DEFAULT 2 CHECK (min_advance_hours >= 0),
  max_per_day integer NOT NULL DEFAULT 10 CHECK (max_per_day > 0),
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_appointment_types_org
  ON active.appointment_types (org_id, is_active);

-- ────────────────────────────────────────────────────────────
-- 2. appointments — compromissos
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  appointment_type_id uuid REFERENCES active.appointment_types(id) ON DELETE SET NULL,
  contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES active.deals(id) ON DELETE SET NULL,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  /** Membro responsável (org_members.id, NÃO user_id direto). */
  assigned_to uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  location_type text CHECK (location_type IN ('online', 'presencial', 'telefone', 'flexivel')),
  location_details text,
  status text NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'confirmed', 'cancelled', 'completed', 'no_show', 'rescheduled')),
  reminder_sent_24h boolean NOT NULL DEFAULT false,
  reminder_sent_1h boolean NOT NULL DEFAULT false,
  cancelled_reason text,
  rescheduled_from uuid REFERENCES active.appointments(id) ON DELETE SET NULL,
  external_calendar_id text,
  external_calendar_provider text
    CHECK (external_calendar_provider IN ('google', 'outlook', 'calendly')),
  notes text,
  created_by_ai boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_appointments_org ON active.appointments (org_id);
CREATE INDEX IF NOT EXISTS idx_appointments_contact ON active.appointments (contact_id);
CREATE INDEX IF NOT EXISTS idx_appointments_assigned ON active.appointments (assigned_to);
CREATE INDEX IF NOT EXISTS idx_appointments_time
  ON active.appointments (org_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS idx_appointments_status_active
  ON active.appointments (org_id, status, start_time)
  WHERE status IN ('scheduled', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_appointments_reminders
  ON active.appointments (start_time)
  WHERE status IN ('scheduled', 'confirmed')
    AND (reminder_sent_24h = false OR reminder_sent_1h = false);

-- ────────────────────────────────────────────────────────────
-- 3. agent_availability — override do business_hours por agente
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.agent_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  agent_id uuid NOT NULL REFERENCES active.org_members(id) ON DELETE CASCADE,
  /** 0=domingo .. 6=sábado. NULL quando specific_date é definida. */
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  start_time time NOT NULL,
  end_time time NOT NULL,
  is_available boolean NOT NULL DEFAULT true,
  /** Override pra data específica (folga, horário extra). */
  specific_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time),
  CHECK (day_of_week IS NOT NULL OR specific_date IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_agent_availability_agent
  ON active.agent_availability (org_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_availability_specific
  ON active.agent_availability (org_id, agent_id, specific_date)
  WHERE specific_date IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.appointment_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.agent_availability ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.appointment_types;
CREATE POLICY "org_isolation" ON active.appointment_types
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.appointments;
CREATE POLICY "org_isolation" ON active.appointments
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.agent_availability;
CREATE POLICY "org_isolation" ON active.agent_availability
  FOR ALL USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- Triggers de updated_at (se a função set_updated_at existir)
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_appointment_types_updated_at ON active.appointment_types;
    EXECUTE 'CREATE TRIGGER trg_appointment_types_updated_at BEFORE UPDATE ON active.appointment_types FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';

    DROP TRIGGER IF EXISTS trg_appointments_updated_at ON active.appointments;
    EXECUTE 'CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON active.appointments FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- Realtime (frontend escuta updates pra atualizar visão do calendário)
-- ────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'active'
      AND tablename = 'appointments'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE active.appointments';
  END IF;
END $$;

ALTER TABLE active.appointments REPLICA IDENTITY DEFAULT;
