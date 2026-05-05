-- 034 reduzido: só a tabela attachments + bucket. Storage policy
-- em arquivo separado pra ser aplicada via Studio (service_role não
-- tem permissão pra mexer em storage.objects policies via SQL exec).

CREATE TABLE IF NOT EXISTS active.attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  message_id      uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES active.conversations(id) ON DELETE CASCADE,
  contact_id      uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  media_type      text NOT NULL CHECK (media_type IN ('image', 'audio', 'video', 'document')),
  mime_type       text,
  file_name       text,
  file_size_bytes bigint,
  storage_path    text NOT NULL,
  metadata        jsonb NOT NULL DEFAULT '{}'::jsonb,
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

INSERT INTO storage.buckets (id, name, public)
VALUES ('message-media', 'message-media', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
