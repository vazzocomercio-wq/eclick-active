-- ═══════════════════════════════════════════════════
-- 078: Social AI — base de conhecimento por estilo/tipo (Estúdio B2)
-- Fontes de referência (imagens + URLs externas) escopadas por estilo/tipo.
-- O toggle "usar dados do produto" fica em recipe.metadata (sem coluna).
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_knowledge_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- escopo: key do estilo/framework (ex 'ugc', 'dsb') ou 'global'
  scope text NOT NULL DEFAULT 'global',
  source_type text NOT NULL CHECK (source_type IN ('image', 'url')),

  value text NOT NULL,          -- URL da imagem ou da página externa
  title text,
  extracted_text text,          -- texto extraído (só URLs), pra injetar no prompt

  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_knowledge_org ON active.social_knowledge_sources(org_id);
CREATE INDEX idx_social_knowledge_scope ON active.social_knowledge_sources(org_id, scope);

ALTER TABLE active.social_knowledge_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "social_knowledge_org" ON active.social_knowledge_sources
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_social_knowledge_updated_at
  BEFORE UPDATE ON active.social_knowledge_sources
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_knowledge_sources
  TO authenticated, service_role;

COMMENT ON TABLE active.social_knowledge_sources IS
  'Base de conhecimento do Social AI por estilo/tipo: imagens de referência + URLs externas (texto extraído). Injetado no prompt no B4.';
