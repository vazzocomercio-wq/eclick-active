-- ═══════════════════════════════════════════════════
-- 104: HeyGen — gerar a partir de TEMPLATE (ambiente fixo)
--
-- O usuário monta no HeyGen Studio templates com avatar+voz+fundo+ambiente+
-- estilo fixos e marca a fala como variável. A automação gera SEMPRE naquele
-- ambiente, passando só o roteiro. Aqui guardamos qual template foi usado; e
-- avatar/voice deixam de ser obrigatórios (no modo template vêm do template).
-- ═══════════════════════════════════════════════════

ALTER TABLE active.heygen_jobs
  ADD COLUMN IF NOT EXISTS template_id text;

ALTER TABLE active.heygen_jobs ALTER COLUMN avatar_id DROP NOT NULL;
ALTER TABLE active.heygen_jobs ALTER COLUMN voice_id  DROP NOT NULL;

NOTIFY pgrst, 'reload schema';
