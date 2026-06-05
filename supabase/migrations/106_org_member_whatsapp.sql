-- 106 — WhatsApp do membro/operador para alertas de tarefa URGENTE
--
-- Contexto: na "Operação de Cadastro" (SaaS) o gestor despacha produtos pro
-- operador escolhendo um nível de prioridade. Quando a prioridade é URGENTE,
-- o SaaS dispara um alerta no WhatsApp do operador (canal grátis/Baileys via
-- wa-router, purpose=internal_alert). Esse número é cadastrado junto do membro
-- na tela de Equipe.
--
-- Aditivo e idempotente: coluna nullable, NULL = membro sem WhatsApp (sem alerta).

ALTER TABLE active.org_members
  ADD COLUMN IF NOT EXISTS whatsapp_phone text;

COMMENT ON COLUMN active.org_members.whatsapp_phone IS
  'Telefone WhatsApp do membro (E.164 ou BR local, só dígitos/+) p/ alertas de tarefa urgente da Operação de Cadastro. NULL = sem alerta.';
