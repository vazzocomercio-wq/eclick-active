-- ═══════════════════════════════════════════════════
-- 080: Blog IA — configurações por org (tom de voz / diretrizes da marca)
-- A voz é injetada nos prompts de geração de artigo e ideação de pautas,
-- pra todo conteúdo sair consistente com a marca.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.blog_settings (
  org_id uuid PRIMARY KEY REFERENCES active.organizations(id) ON DELETE CASCADE,
  voice_guidelines text,          -- tom de voz / diretrizes editoriais da marca
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE active.blog_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_settings_org" ON active.blog_settings
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_blog_settings_updated_at
  BEFORE UPDATE ON active.blog_settings
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.blog_settings TO authenticated, service_role;

COMMENT ON TABLE active.blog_settings IS
  'Config do Blog IA por org: tom de voz/diretrizes da marca, injetado nos prompts de geração.';
