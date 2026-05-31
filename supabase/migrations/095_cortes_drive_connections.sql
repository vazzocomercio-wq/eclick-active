-- ═══════════════════════════════════════════════════
-- 095: Studio de Cortes — conexão OAuth do Google Drive por org
--
-- Conta pessoal (Gmail) não tem Shared Drive, e a Service Account não tem
-- cota de storage. Solução: OAuth com a conta do usuário (escopo drive.file,
-- não-sensível) → arquivos ficam no Drive do usuário, contam a cota dele.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.cortes_drive_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  google_email text,
  -- Tokens cifrados (LLM_CRED_ENCRYPTION_KEY, mesmo util do llm/crypto.util)
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,

  -- Pasta raiz "e-Click Cortes" criada pelo app no Drive do usuário
  root_folder_id text,

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id)
);

CREATE INDEX idx_cortes_drive_conn_org ON active.cortes_drive_connections(org_id);

CREATE TRIGGER trg_cortes_drive_conn_updated_at
  BEFORE UPDATE ON active.cortes_drive_connections
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.cortes_drive_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cortes_drive_conn_org" ON active.cortes_drive_connections
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.cortes_drive_connections
  TO authenticated, service_role;
