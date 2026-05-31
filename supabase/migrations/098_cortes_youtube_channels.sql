-- ═══════════════════════════════════════════════════
-- 098: Studio de Cortes — canais do YouTube (multi-canal, separado do Drive)
--
-- O Drive (cortes_drive_connections) é só armazenamento (conta da org). O
-- YouTube vira conta/canal selecionável: o usuário conecta o canal certo
-- (ex: e-Click Oficial, um Brand Channel) num fluxo próprio onde o Google
-- mostra o seletor de canal. Cada linha = um canal conectado.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.cortes_youtube_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  youtube_channel_id text NOT NULL,   -- id do canal (UC...)
  title text,                         -- nome do canal (e-Click Oficial)
  thumbnail_url text,
  google_email text,

  -- Tokens cifrados (mesmo util do Drive/llm)
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',

  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, youtube_channel_id)
);

CREATE INDEX idx_cortes_yt_channels_org ON active.cortes_youtube_channels(org_id);

CREATE TRIGGER trg_cortes_yt_channels_updated_at
  BEFORE UPDATE ON active.cortes_youtube_channels
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.cortes_youtube_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cortes_yt_channels_org" ON active.cortes_youtube_channels
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.cortes_youtube_channels
  TO authenticated, service_role;
