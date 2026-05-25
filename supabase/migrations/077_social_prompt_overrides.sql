-- ═══════════════════════════════════════════════════
-- 077: Social AI — overrides de estilos/frameworks/system prompts
-- Permite o lojista editar pela UI os textos que hoje vivem no código
-- (video-styles.ts + prompts.ts). Armazenamento ESPARSO: só o que foi
-- editado fica aqui; o código continua sendo o default/fallback.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_prompt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- 'video_style' (ex key 'ugc'), 'framework' (ex 'dsb'),
  -- 'system_prompt' (ex 'POST_SYSTEM_PROMPT')
  kind text NOT NULL CHECK (kind IN ('video_style', 'framework', 'system_prompt')),
  key text NOT NULL,

  label text,             -- rótulo customizado (estilos/frameworks)
  prompt text NOT NULL,   -- o texto (hint do estilo / dica do framework / system prompt)
  camera text,            -- câmera sugerida (só video_style)

  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, kind, key)
);

CREATE INDEX idx_social_prompt_overrides_org
  ON active.social_prompt_overrides(org_id);

ALTER TABLE active.social_prompt_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_prompt_overrides_org" ON active.social_prompt_overrides
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_social_prompt_overrides_updated_at
  BEFORE UPDATE ON active.social_prompt_overrides
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_prompt_overrides
  TO authenticated, service_role;

COMMENT ON TABLE active.social_prompt_overrides IS
  'Overrides editáveis pela UI de estilos de vídeo / frameworks / system prompts. Esparso: só o editado; código = fallback.';
