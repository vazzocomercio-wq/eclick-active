-- ============================================================
-- 020: Conversations — flag is_starred (favoritar)
-- ============================================================
-- Permite marcar conversas como favoritas pra acesso rápido na inbox.
-- Index parcial pra filtro "Favoritas" devolver instantâneo mesmo com
-- milhares de conversas na org.
-- ============================================================

ALTER TABLE active.conversations
  ADD COLUMN IF NOT EXISTS is_starred boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_conversations_starred
  ON active.conversations (org_id, is_starred, last_message_at DESC NULLS LAST)
  WHERE is_starred = true;

-- Recria v_inbox incluindo is_starred. Postgres não aceita CREATE OR REPLACE
-- VIEW se a ordem das colunas mudar — por isso DROP + CREATE.
DROP VIEW IF EXISTS active.v_inbox;

CREATE VIEW active.v_inbox AS
SELECT
  c.id,
  c.org_id,
  c.status,
  c.priority,
  c.assigned_to,
  c.unread_count,
  c.ai_summary,
  c.ai_sentiment,
  c.ai_intent,
  c.ai_temperature,
  c.ai_next_action,
  c.tags,
  c.last_message_at,
  c.first_response_at,
  c.is_starred,
  c.created_at,
  c.channel_type,
  ct.id AS contact_id,
  ct.name AS contact_name,
  ct.phone AS contact_phone,
  ct.email AS contact_email,
  ct.avatar_url AS contact_avatar,
  ct.temperature AS contact_temperature,
  ct.score AS contact_score,
  ch.name AS channel_name,
  om.display_name AS agent_name,
  om.avatar_url AS agent_avatar
FROM active.conversations c
LEFT JOIN active.contacts ct ON ct.id = c.contact_id
LEFT JOIN active.channels ch ON ch.id = c.channel_id
LEFT JOIN active.org_members om ON om.user_id = c.assigned_to AND om.org_id = c.org_id;
