-- ═══════════════════════════════════════════════════
-- 055: Social MVP 2 — Publicação automática
-- Credenciais OAuth de canais (Meta/TikTok) + log de
-- tentativas de publicação + campos extras em
-- social_contents pra rastrear publish status.
-- ═══════════════════════════════════════════════════

-- ─── 1. social_channel_credentials ───────────────
-- Tokens OAuth dos canais sociais. Encrypted via AES-GCM
-- (mesma chave do org_llm_credentials — LLM_CRED_ENCRYPTION_KEY).
CREATE TABLE active.social_channel_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE CASCADE,

  -- Canal: 'instagram_business' | 'tiktok_business' | 'facebook_page'
  channel text NOT NULL CHECK (channel IN (
    'instagram_business', 'tiktok_business', 'facebook_page'
  )),

  -- Identificadores externos do canal
  external_account_id text NOT NULL,
  external_username text,
  external_account_name text,

  -- Token criptografado (AES-256-GCM, mesma cred util que LLM)
  access_token_ciphertext text NOT NULL,
  refresh_token_ciphertext text,

  -- Metadata da conta
  expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',

  -- Operacional
  is_active boolean NOT NULL DEFAULT true,
  last_validated_at timestamptz,
  last_error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, channel, external_account_id)
);

CREATE INDEX idx_social_creds_org ON active.social_channel_credentials(org_id);
CREATE INDEX idx_social_creds_brand ON active.social_channel_credentials(brand_id);
CREATE INDEX idx_social_creds_channel ON active.social_channel_credentials(org_id, channel) WHERE is_active = true;

CREATE TRIGGER trg_social_creds_updated_at
  BEFORE UPDATE ON active.social_channel_credentials
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. social_publish_attempts ──────────────────
-- Log de cada tentativa de publicação (auditoria + retries).
CREATE TABLE active.social_publish_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  content_id uuid NOT NULL REFERENCES active.social_contents(id) ON DELETE CASCADE,

  channel text NOT NULL,
  credential_id uuid REFERENCES active.social_channel_credentials(id) ON DELETE SET NULL,

  status text NOT NULL CHECK (status IN ('pending', 'success', 'failed', 'partial')),
  external_post_id text,
  external_post_url text,

  -- Provider-specific response (creation_id, container_ids, error code, etc.)
  provider_response jsonb NOT NULL DEFAULT '{}',

  error_message text,
  error_code text,

  -- Timing
  attempted_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer
);

CREATE INDEX idx_publish_attempts_content ON active.social_publish_attempts(content_id, attempted_at DESC);
CREATE INDEX idx_publish_attempts_org ON active.social_publish_attempts(org_id, attempted_at DESC);
CREATE INDEX idx_publish_attempts_status ON active.social_publish_attempts(org_id, status);

-- ─── 3. Extras em social_contents pra publish ────
ALTER TABLE active.social_contents
  ADD COLUMN IF NOT EXISTS publish_attempts_count integer NOT NULL DEFAULT 0;
ALTER TABLE active.social_contents
  ADD COLUMN IF NOT EXISTS last_publish_error text;

-- Índice pra worker pick-up (scheduled vencidos prontos pra publicar)
CREATE INDEX IF NOT EXISTS idx_social_contents_publish_queue
  ON active.social_contents(org_id, scheduled_for)
  WHERE status = 'scheduled';

-- ─── 4. RLS ──────────────────────────────────────
ALTER TABLE active.social_channel_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_publish_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_creds_org" ON active.social_channel_credentials
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "publish_attempts_org" ON active.social_publish_attempts
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 5. Realtime ─────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_publish_attempts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── 6. Grants ───────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_channel_credentials TO authenticated, service_role;
GRANT SELECT, INSERT ON active.social_publish_attempts TO authenticated, service_role;
