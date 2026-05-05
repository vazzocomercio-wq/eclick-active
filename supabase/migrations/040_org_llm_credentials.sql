-- ============================================================
-- 040: org_llm_credentials — credenciais de LLM por org
-- ============================================================
-- Bloco A do Active Intelligence: cada org escolhe provider+modelo+API key
-- pra todas as chamadas de IA do produto. Sem cred configurada → fallback
-- pro env global ANTHROPIC_API_KEY (onboarding) com modelo default.
--
-- API key armazenada cifrada com AES-256-GCM. Chave de criptografia em
-- env LLM_CRED_ENCRYPTION_KEY (32 bytes hex). Formato do ciphertext:
-- base64(iv(12) || tag(16) || ciphertext) — decifrado em llm/crypto.util.ts.
--
-- Modelos suportados (catálogo no código, não no DB pra evitar migração
-- a cada modelo novo):
--   anthropic: claude-sonnet-4-6, claude-opus-4, claude-haiku-4
--   openai:    gpt-5, gpt-5-mini, gpt-4.1
--   google:    gemini-2.5-pro, gemini-2.5-flash
-- ============================================================

CREATE TABLE IF NOT EXISTS active.org_llm_credentials (
  org_id              uuid PRIMARY KEY REFERENCES active.organizations(id) ON DELETE CASCADE,
  provider            text NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google')),
  model_default       text NOT NULL,
  /** AES-GCM ciphertext em base64 (iv||tag||ct). Nunca exposto via API. */
  api_key_ciphertext  text NOT NULL,
  /** Últimos 4 chars da api_key em claro pra UI mostrar "sk-...XXXX". */
  api_key_last4       text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE active.org_llm_credentials ENABLE ROW LEVEL SECURITY;

-- Org isolation: usuários só veem cred da própria org.
DROP POLICY IF EXISTS "org_isolation" ON active.org_llm_credentials;
CREATE POLICY "org_isolation" ON active.org_llm_credentials
  FOR ALL USING (org_id = active.get_user_org_id());

-- Trigger pra updated_at automático
CREATE OR REPLACE FUNCTION active.tg_org_llm_credentials_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_org_llm_credentials_updated_at ON active.org_llm_credentials;
CREATE TRIGGER tg_org_llm_credentials_updated_at
  BEFORE UPDATE ON active.org_llm_credentials
  FOR EACH ROW EXECUTE FUNCTION active.tg_org_llm_credentials_updated_at();

COMMENT ON TABLE active.org_llm_credentials IS
  'LLM provider/model/API key por org. API key cifrada com AES-GCM (LLM_CRED_ENCRYPTION_KEY).';
COMMENT ON COLUMN active.org_llm_credentials.api_key_ciphertext IS
  'base64(iv(12) || tag(16) || ciphertext). Decifrado em llm/crypto.util.ts.';
