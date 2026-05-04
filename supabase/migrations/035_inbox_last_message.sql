-- Adiciona `last_message_text` à view v_inbox pra mostrar preview da
-- última mensagem na lista de conversas. Antes a UI caía no fallback
-- "Sem mensagens" mesmo em conversas ativas.
--
-- LATERAL JOIN pega a última msg (text) por conversation_id sem precisar
-- escrever em `conversations.last_message_text` (denormalizado). Com índice
-- (conversation_id, created_at DESC) já existente em messages, é eficiente.

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
  om.avatar_url AS agent_avatar,
  -- Preview: texto da última mensagem da conversa (truncado à 200 chars).
  -- Mídia retorna null em plain_text — UI pode mostrar fallback "[mídia]".
  lm.plain_text AS last_message_text,
  lm.direction AS last_message_direction
FROM active.conversations c
LEFT JOIN active.contacts ct ON ct.id = c.contact_id
LEFT JOIN active.channels ch ON ch.id = c.channel_id
LEFT JOIN active.org_members om ON om.user_id = c.assigned_to AND om.org_id = c.org_id
LEFT JOIN LATERAL (
  SELECT m.plain_text, m.direction
  FROM active.messages m
  WHERE m.conversation_id = c.id
  ORDER BY m.created_at DESC
  LIMIT 1
) lm ON true;

NOTIFY pgrst, 'reload schema';
