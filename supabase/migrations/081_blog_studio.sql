-- ═══════════════════════════════════════════════════
-- 081: Blog IA — Estúdio do Blog
--  (a) prompts editáveis pela UI (system prompts de artigo/ideação)
--  (b) base de conhecimento (URLs/textos/imagens de referência)
-- Ambos injetados na geração; o código continua sendo o default/fallback.
-- ═══════════════════════════════════════════════════

-- (a) Overrides de system prompt — esparso: só o editado fica aqui.
CREATE TABLE active.blog_prompt_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,            -- 'article' | 'ideate'
  prompt text NOT NULL,         -- o system prompt customizado
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, key)
);

CREATE INDEX idx_blog_prompt_overrides_org ON active.blog_prompt_overrides(org_id);

ALTER TABLE active.blog_prompt_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_prompt_overrides_org" ON active.blog_prompt_overrides
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_blog_prompt_overrides_updated_at
  BEFORE UPDATE ON active.blog_prompt_overrides
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.blog_prompt_overrides
  TO authenticated, service_role;

COMMENT ON TABLE active.blog_prompt_overrides IS
  'System prompts editáveis do Blog IA (key article/ideate). Esparso: só o editado; código = fallback.';

-- (b) Base de conhecimento — referências injetadas no prompt de geração.
CREATE TABLE active.blog_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('url', 'text', 'image')),
  value text NOT NULL,          -- URL, texto cru, ou URL da imagem
  title text,
  extracted_text text,          -- texto extraído (URLs), pra injetar no prompt
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_knowledge_org ON active.blog_knowledge_sources(org_id);

ALTER TABLE active.blog_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_knowledge_org" ON active.blog_knowledge_sources
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_blog_knowledge_updated_at
  BEFORE UPDATE ON active.blog_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.blog_knowledge_sources
  TO authenticated, service_role;

COMMENT ON TABLE active.blog_knowledge_sources IS
  'Base de conhecimento do Blog IA: URLs/textos/imagens de referência injetados no prompt de geração.';
