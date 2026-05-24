-- ============================================================
-- 074: BYOK enforcement — ai_keys_mode + slot OpenAI dedicado
-- ============================================================
-- Objetivo: clientes usam as PRÓPRIAS chaves de IA (créditos deles).
--
-- 1. active.organizations.ai_keys_mode:
--      'platform' → org usa a chave do servidor (env ANTHROPIC_API_KEY /
--                   OPENAI_API_KEY). Comportamento atual.
--      'own'      → org DEVE ter chave própria; sem chave, a feature de IA
--                   é bloqueada com aviso (BYOK obrigatório).
--    Default 'platform' pra NÃO bloquear orgs existentes nem onboarding.
--
-- 2. org_llm_credentials ganha um slot OpenAI dedicado, independente do
--    provider de chat escolhido. Necessário porque Whisper (transcrição),
--    embeddings (busca semântica) e DALL·E (Social AI) são OpenAI-only —
--    se o provider de chat da org for anthropic/google, ela ainda precisa
--    de uma chave OpenAI pra esses serviços auxiliares.
--    (Quando o provider de chat JÁ é openai, o backend reusa a chave de
--     chat e estas colunas ficam null.)
-- ============================================================

-- 1. Modo de chaves de IA por org
ALTER TABLE active.organizations
  ADD COLUMN IF NOT EXISTS ai_keys_mode text NOT NULL DEFAULT 'platform';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'active'
      AND table_name = 'organizations'
      AND constraint_name = 'organizations_ai_keys_mode_check'
  ) THEN
    ALTER TABLE active.organizations
      ADD CONSTRAINT organizations_ai_keys_mode_check
      CHECK (ai_keys_mode IN ('platform', 'own'));
  END IF;
END $$;

COMMENT ON COLUMN active.organizations.ai_keys_mode IS
  'platform = usa chave do servidor; own = exige chave própria (bloqueia IA sem chave).';

-- 2. Slot OpenAI dedicado pros serviços auxiliares (Whisper/embeddings/DALL·E)
ALTER TABLE active.org_llm_credentials
  ADD COLUMN IF NOT EXISTS openai_api_key_ciphertext text,
  ADD COLUMN IF NOT EXISTS openai_api_key_last4      text;

COMMENT ON COLUMN active.org_llm_credentials.openai_api_key_ciphertext IS
  'Chave OpenAI dedicada (AES-GCM base64) pra Whisper/embeddings/DALL·E quando o provider de chat não é openai. Nullable.';

-- 3. Orgs existentes ficam explicitamente em platform (matriz Vazzo + Eslar
--    continuam usando as chaves do servidor — não quebrar nada).
UPDATE active.organizations
   SET ai_keys_mode = 'platform'
 WHERE id IN (
   '98ea944c-50bd-424d-9a57-d00a87a9525b',  -- Vazzo Comercio (matriz)
   'c469d74d-b792-4b56-83f8-5be2a2136f5b'   -- Eslar
 );
