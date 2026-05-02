-- ============================================================
-- 013: conversations.status — adiciona 'archived'
-- ============================================================
-- Permite soft-delete de conversas. Conversas archived ficam ocultas
-- da inbox por padrão (filter 'Arquivadas' mostra). Mensagens são
-- preservadas pra relatórios.
-- ============================================================

ALTER TABLE active.conversations
  DROP CONSTRAINT IF EXISTS conversations_status_check;

ALTER TABLE active.conversations
  ADD CONSTRAINT conversations_status_check
  CHECK (status IN ('open', 'pending', 'snoozed', 'resolved', 'closed', 'archived'));
