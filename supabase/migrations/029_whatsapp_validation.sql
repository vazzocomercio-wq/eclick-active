-- Bloco Conversa Ativa — Validação de número WhatsApp + iniciar conversa
--
-- Adiciona campos no contato para guardar o resultado da verificação
-- (se o número é WhatsApp, o JID canônico, foto de perfil) e cria uma
-- fila pra processar validações em batch respeitando rate limit.
--
-- O JID guardado evita re-validação e permite envio confiável quando o
-- vendedor inicia uma conversa do zero pelo CRM ("prospecção ativa").

ALTER TABLE active.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_verified boolean,
  ADD COLUMN IF NOT EXISTS whatsapp_jid text,
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS whatsapp_profile_name text,
  ADD COLUMN IF NOT EXISTS whatsapp_profile_pic_url text;

COMMENT ON COLUMN active.contacts.whatsapp_verified IS
  'NULL = não validado, TRUE = é WhatsApp ativo, FALSE = não é WhatsApp';
COMMENT ON COLUMN active.contacts.whatsapp_jid IS
  'JID canônico (ex: 5571999999999@s.whatsapp.net). Usado pra envio direto via Baileys sem re-resolver.';

CREATE INDEX IF NOT EXISTS idx_contacts_whatsapp
  ON active.contacts(org_id, whatsapp_verified)
  WHERE whatsapp_verified = true;

-- Fila de validação (processada pelo worker em batches respeitando rate limit)
CREATE TABLE IF NOT EXISTS active.whatsapp_validation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES active.contacts(id) ON DELETE CASCADE,
  phone text NOT NULL,
  status text DEFAULT 'pending' CHECK (
    status IN ('pending', 'validating', 'valid', 'invalid', 'error')
  ),
  provider text CHECK (provider IN ('baileys', 'zapi')),
  result jsonb,
  error_message text,
  attempts int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  processed_at timestamptz,
  UNIQUE (org_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_validation_queue_pending
  ON active.whatsapp_validation_queue (created_at)
  WHERE status = 'pending';

ALTER TABLE active.whatsapp_validation_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.whatsapp_validation_queue;
CREATE POLICY "org_isolation" ON active.whatsapp_validation_queue
  FOR ALL USING (org_id = active.get_user_org_id());

NOTIFY pgrst, 'reload schema';
