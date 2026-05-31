-- ═══════════════════════════════════════════════════════════════════
-- 096 — Ads Performance Agent (F12 MVP-4): modo de decisão por conta
--
-- copilot (default) = motor SÓ sugere; humano aprova cada ação.
-- auto             = motor pode APLICAR sozinho ações conservadoras
--                    (pausar/reduzir orçamento) de alta confiança, dentro
--                    dos guardrails (±20%, kill-switch, reversível).
-- Escalar orçamento (aumentar gasto) PERMANECE manual mesmo em auto.
-- OFF por padrão — opt-in explícito por conta.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE active.ads_accounts
  ADD COLUMN IF NOT EXISTS decision_mode text NOT NULL DEFAULT 'copilot'
    CHECK (decision_mode IN ('copilot', 'auto'));
