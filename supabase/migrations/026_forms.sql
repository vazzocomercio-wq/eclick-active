-- ============================================================
-- 026: Form Builder — formulários públicos + submissões
-- ============================================================
-- Forms internos do CRM. O admin cria via drag-and-drop, publica
-- como link/embed/QR. Cada submissão dispara o pipeline de auto-lead:
-- contato + deal + IA + WhatsApp welcome (configuráveis).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.forms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  /** Slug usado em /f/:slug — único por org */
  slug text NOT NULL,
  description text,
  /** Array de FormField definitions (estrutura em packages/shared) */
  fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  /** FormSettings: pipeline_id, assignment, welcome_message, etc. */
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** FormBranding: logo, cores, header_text, footer_text */
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  template_category text,
  submissions_count integer NOT NULL DEFAULT 0,
  /** % de submissões que viraram deal ganho (calculado periodicamente) */
  conversion_rate numeric(5, 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_forms_org
  ON active.forms (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_forms_slug_active
  ON active.forms (org_id, slug)
  WHERE status = 'active';

-- ────────────────────────────────────────────────────────────
-- form_submissions
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id uuid NOT NULL REFERENCES active.forms(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  /** Dados raw do submit — { field_id: value } */
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES active.deals(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'link'
    CHECK (source IN ('link', 'embed', 'qrcode', 'whatsapp', 'api')),
  ip_address text,
  user_agent text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  processed boolean NOT NULL DEFAULT false,
  /** Resumo do que foi feito: { contact_id, deal_id, agent_assigned, etc. } */
  processing_result jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_form
  ON active.form_submissions (form_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_org_date
  ON active.form_submissions (org_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_form_submissions_contact
  ON active.form_submissions (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_utm
  ON active.form_submissions (org_id, utm_source, utm_campaign)
  WHERE utm_source IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.forms ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.form_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.forms;
CREATE POLICY "org_isolation" ON active.forms
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.form_submissions;
CREATE POLICY "org_isolation" ON active.form_submissions
  FOR ALL USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- Trigger: incrementa submissions_count na forms quando insere
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION active.increment_form_submissions()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE active.forms
  SET
    submissions_count = submissions_count + 1,
    updated_at = now()
  WHERE id = NEW.form_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_form_submission_count ON active.form_submissions;
CREATE TRIGGER trg_form_submission_count
  AFTER INSERT ON active.form_submissions
  FOR EACH ROW EXECUTE FUNCTION active.increment_form_submissions();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_forms_updated_at ON active.forms;
    EXECUTE 'CREATE TRIGGER trg_forms_updated_at BEFORE UPDATE ON active.forms FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;
