-- ============================================================
-- 051: pipeline_stages.requires_human — flag pra silenciar Concierge IA
-- ============================================================
-- Comportamento da IA do Concierge mudou:
--   ANTES: parava de responder assim que decidia rotear (state='routed').
--   DEPOIS: continua respondendo como atendente, e só silencia quando:
--     - Deal do contato está em stage com requires_human=true
--     - Contato tem appointment com status='scheduled' (agendamento confirmado)
--     - Atingiu MAX_FOLLOW_UP_COUNT por conversation
--
-- Esse flag permite admin marcar stages onde atendimento humano é
-- obrigatório (ex: "Aguardando atendente", "Em negociação avançada",
-- "Escalado pra suporte"). Default false — IA atua na maioria das stages.
-- ============================================================

ALTER TABLE active.pipeline_stages
  ADD COLUMN IF NOT EXISTS requires_human boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN active.pipeline_stages.requires_human IS
  'Quando true, IA Concierge silencia em deals nessa stage. Permite garantir handoff humano em pontos críticos do funil.';
