-- ============================================================
-- 024: Canal Email — tracking de threads (Message-ID/References)
-- ============================================================
-- Email é diferente dos outros canais: cada thread (sequência de replies
-- com mesmo Message-ID raiz) deve virar UMA conversation. Pra isso
-- precisamos rastrear thread_id (Message-ID raiz) → conversation_id.
--
-- Quando chega um email novo:
--   1. Lê In-Reply-To e References headers
--   2. Procura email_threads.thread_id pelo último Message-ID
--   3. Se achou → vincula à conversation existente
--   4. Se não → cria nova thread + nova conversation
-- ============================================================

CREATE TABLE IF NOT EXISTS active.email_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES active.channels(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  /** Message-ID raiz da thread (primeiro email da sequência). */
  thread_id text NOT NULL,
  subject text,
  /** Último Message-ID — usado em In-Reply-To pra threading correto no envio. */
  last_message_id text,
  message_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, channel_id, thread_id)
);

CREATE INDEX IF NOT EXISTS idx_email_threads_org
  ON active.email_threads (org_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_thread
  ON active.email_threads (org_id, thread_id);
CREATE INDEX IF NOT EXISTS idx_email_threads_last_message_id
  ON active.email_threads (org_id, last_message_id)
  WHERE last_message_id IS NOT NULL;

ALTER TABLE active.email_threads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.email_threads;
CREATE POLICY "org_isolation" ON active.email_threads
  FOR ALL USING (org_id = active.get_user_org_id());

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_email_threads_updated_at ON active.email_threads;
    EXECUTE 'CREATE TRIGGER trg_email_threads_updated_at BEFORE UPDATE ON active.email_threads FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;
