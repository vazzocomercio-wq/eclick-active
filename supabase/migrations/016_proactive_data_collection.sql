-- ============================================================
-- 016: Coleta proativa de dados — required fields por stage
-- ============================================================
-- Bloco G PARTE 1: o admin define dados obrigatórios por pipeline stage.
-- Quando deal está nesse stage e faltam dados, a IA pergunta naturalmente
-- na conversa e extrai a resposta.
--
-- Nota: transfer_briefing e pending_transfer ficam em conversations.metadata
-- (jsonb) — não precisa coluna nova. Notification severity 'urgent' já
-- existe no enum.
-- ============================================================

ALTER TABLE active.pipeline_stages
  ADD COLUMN IF NOT EXISTS required_contact_fields text[] NOT NULL DEFAULT '{}';

ALTER TABLE active.pipeline_stages
  ADD COLUMN IF NOT EXISTS required_deal_fields text[] NOT NULL DEFAULT '{}';

-- Adiciona settings do auto-escalation em ai_feature_settings (idempotente)
INSERT INTO active.ai_feature_settings (org_id, feature_name, provider, model, is_enabled, config)
SELECT
  o.id,
  'auto_escalation',
  'anthropic',
  'claude-haiku-4-5',
  true,
  jsonb_build_object(
    'confidence_threshold', 60,
    'create_task', true,
    'notify_agent', true,
    'block_auto_respond', true
  )
FROM active.organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM active.ai_feature_settings s
  WHERE s.org_id = o.id AND s.feature_name = 'auto_escalation'
)
ON CONFLICT DO NOTHING;
