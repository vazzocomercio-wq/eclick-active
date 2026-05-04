-- Adiciona coluna metadata jsonb em active.conversations.
--
-- O AiConciergeService usa essa coluna pra persistir o estado do
-- concierge (idle / awaiting_response / routed) via merge no JSONB.
-- A coluna nunca foi criada em migration anterior, então o handler
-- crashava silenciosamente ao tentar UPDATE — Concierge nunca rodava
-- em produção, e o fluxo paralelo (classify_intent + suggest_response)
-- seguia rodando, mascarando o problema.
--
-- Idempotente. Default '{}' pra rows existentes.

ALTER TABLE active.conversations
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

NOTIFY pgrst, 'reload schema';
