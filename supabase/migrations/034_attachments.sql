-- Tabela `attachments` — guarda metadata de mídia anexada a mensagens.
-- O blob real fica no Supabase Storage no bucket `message-media`.
--
-- Cada row liga 1-pra-1 com `messages` (uma msg pode ter vários
-- attachments quando o cliente manda múltiplas fotos numa única mensagem
-- de mídia agrupada — Baileys quebra cada mídia em msg separada,
-- então 1:1 cobre a maioria dos casos).
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS active.attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES active.conversations(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  -- Tipo de mídia: image | audio | video | document
  media_type      text NOT NULL CHECK (media_type IN ('image', 'audio', 'video', 'document')),
  mime_type       text,
  file_name       text,
  file_size_bytes bigint,
  -- Path no Supabase Storage bucket `message-media`. Formato:
  --   {org_id}/{conversation_id}/{message_id}/{uuid}-{filename}
  storage_path    text NOT NULL,
  -- Metadata extra: dimensions de imagem, duration de audio/video, etc.
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Resumo + extração da IA (quando processado por Vision/text extraction).
  -- Preenchido em background pela Sub-fase 2.B.
  ai_summary      text,
  ai_extracted    jsonb,
  ai_processed_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_attachments_message
  ON active.attachments (message_id);

CREATE INDEX IF NOT EXISTS idx_attachments_conversation
  ON active.attachments (conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_contact
  ON active.attachments (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attachments_pending_ai
  ON active.attachments (org_id, created_at)
  WHERE ai_processed_at IS NULL;

DROP TRIGGER IF EXISTS trg_attachments_updated_at ON active.attachments;
CREATE TRIGGER trg_attachments_updated_at
  BEFORE UPDATE ON active.attachments
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS attachments_select_own ON active.attachments;
CREATE POLICY attachments_select_own ON active.attachments
  FOR SELECT USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS attachments_modify_own ON active.attachments;
CREATE POLICY attachments_modify_own ON active.attachments
  FOR ALL USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

NOTIFY pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────
-- Storage bucket `message-media` (privado, signed URLs)
-- ────────────────────────────────────────────────────────────
-- Cria o bucket se não existir. RLS via storage.objects garante que
-- só o service_role e o user da org dona conseguem listar.
INSERT INTO storage.buckets (id, name, public)
VALUES ('message-media', 'message-media', false)
ON CONFLICT (id) DO NOTHING;

-- Policy: org member pode ler arquivos cujo path comece com seu org_id.
-- Backend usa service_role e ignora isso, mas frontend autenticado pode
-- baixar via signed URL (que o backend gera).
DROP POLICY IF EXISTS message_media_org_read ON storage.objects;
CREATE POLICY message_media_org_read ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'message-media'
    AND (storage.foldername(name))[1] = active.get_user_org_id()::text
  );
