-- Auto-unarchive: quando mensagem inbound chega em conversa arquivada
-- ou resolvida, ela volta pra 'open' automaticamente.
--
-- Cobre TODOS os caminhos de inbound (Z-API, Email, Instagram, TikTok,
-- Baileys/worker) sem precisar repetir lógica em cada webhook.
--
-- Comportamento padrão de mensageiros (WhatsApp Web, Telegram, etc):
-- arquivar é "esconder até nova interação", não "fechar pra sempre".

CREATE OR REPLACE FUNCTION active.unarchive_on_inbound()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = active, pg_temp
AS $$
BEGIN
  IF NEW.direction = 'inbound' AND NEW.is_internal_note = false THEN
    UPDATE active.conversations
       SET status = 'open',
           resolved_at = NULL,
           updated_at = now()
     WHERE id = NEW.conversation_id
       AND status IN ('archived', 'resolved', 'closed');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_messages_unarchive ON active.messages;
CREATE TRIGGER trg_messages_unarchive
  AFTER INSERT ON active.messages
  FOR EACH ROW EXECUTE FUNCTION active.unarchive_on_inbound();

NOTIFY pgrst, 'reload schema';
