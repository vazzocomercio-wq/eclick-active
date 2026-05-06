-- ═══════════════════════════════════════════════════
-- 063: Multi-stage approval — cliente externo revisa
-- conteúdos via link público com token antes da
-- aprovação interna final.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_approval_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,

  -- Identificação do reviewer externo
  reviewer_name text NOT NULL,
  reviewer_email text,
  stage_label text NOT NULL DEFAULT 'Cliente',

  -- Token único pra acesso público (sem auth)
  access_token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,

  -- Decisão
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',     -- aguardando reviewer
    'approved',    -- reviewer aprovou
    'rejected',    -- reviewer rejeitou
    'expired',     -- prazo expirou sem ação
    'cancelled'    -- usuário interno cancelou
  )),
  decision_at timestamptz,
  decision_notes text,

  -- Audit
  created_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  viewed_at timestamptz,
  view_count integer NOT NULL DEFAULT 0,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_approval_stages_content ON active.social_approval_stages(content_id, created_at DESC);
CREATE INDEX idx_approval_stages_token ON active.social_approval_stages(access_token);
CREATE INDEX idx_approval_stages_org_status ON active.social_approval_stages(org_id, status);
CREATE INDEX idx_approval_stages_pending
  ON active.social_approval_stages(content_id) WHERE status = 'pending';

CREATE TRIGGER trg_approval_stages_updated_at
  BEFORE UPDATE ON active.social_approval_stages
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.social_approval_stages ENABLE ROW LEVEL SECURITY;

-- Acesso interno: por org
CREATE POLICY "approval_stages_org" ON active.social_approval_stages
  FOR ALL USING (org_id = active.get_user_org_id());

-- Acesso público (sem auth) é via service_role no endpoint /public/...
-- — RLS não bloqueia service_role.

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_approval_stages TO authenticated, service_role;
