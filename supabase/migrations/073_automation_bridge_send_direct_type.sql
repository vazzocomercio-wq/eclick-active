-- 073 — automation_executions: permitir execution_type 'whatsapp_send_direct'
--
-- BUG (descoberto 2026-05-22): o CHECK criado na migration 068 só listava
-- 'whatsapp_notify_lojista', 'cart_recovery_send', 'whatsapp_broadcast'. Quando
-- o endpoint send-direct (S2) entrou, ele insere execution_type='whatsapp_send_direct'
-- ANTES de tentar enviar (audit). Sem o valor no CHECK, o INSERT estourava 500 e o
-- SaaS tratava como skipped_no_bridge em silêncio → OTP do Ambientador, entrega de
-- imagens, recovery de carrinho e push de leads falhavam sem erro visível.
--
-- Fix: recriar o CHECK incluindo todos os ExecutionType do código. Só ALARGA o
-- allowlist (nunca rejeita linha existente) — seguro.

ALTER TABLE active.automation_executions
  DROP CONSTRAINT IF EXISTS automation_executions_execution_type_check;

ALTER TABLE active.automation_executions
  ADD CONSTRAINT automation_executions_execution_type_check
  CHECK (execution_type IN (
    'whatsapp_notify_lojista',
    'cart_recovery_send',
    'whatsapp_broadcast',
    'whatsapp_send_direct'
  ));
