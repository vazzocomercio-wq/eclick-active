-- ═══════════════════════════════════════════════════
-- 079: Blog IA — pipeline de conteúdo do blog gerado por IA
-- A IA gera pauta + artigo (GEO-otimizado) + capa → fila de revisão →
-- aprovado/agendado → ao publicar grava no Sanity (canônico) e o site
-- público (eclick.app.br/blog) renderiza. Este registro é o working draft
-- + estado do pipeline.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.blog_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- ── conteúdo (rascunho de trabalho) ──────────────────────────────
  title text NOT NULL,
  slug text NOT NULL,
  excerpt text,
  tldr jsonb NOT NULL DEFAULT '[]',              -- string[]
  body jsonb NOT NULL DEFAULT '[]',              -- Portable Text blocks (Sanity)
  faq jsonb NOT NULL DEFAULT '[]',               -- [{question, answer}]
  ai_prompts jsonb NOT NULL DEFAULT '[]',        -- string[] (perguntas que o post responde — GEO)
  citation_sources jsonb NOT NULL DEFAULT '[]',  -- [{title, url, authorOrOrg, year}]
  category text,                                  -- slug do pilar editorial
  tags jsonb NOT NULL DEFAULT '[]',              -- string[]
  cover_image_url text,                           -- URL da capa gerada (Storage)
  seo_title text,
  meta_description text,
  focus_keyword text,
  reading_time_minutes int,

  -- ── pipeline ─────────────────────────────────────────────────────
  status text NOT NULL DEFAULT 'generating'
    CHECK (status IN ('generating','review','approved','scheduled','published','failed','archived')),
  scheduled_for timestamptz,                      -- agendamento (Fase 3)
  sanity_doc_id text,                             -- _id no Sanity após publicar
  published_at timestamptz,
  rejected_reason text,

  -- ── origem / IA ──────────────────────────────────────────────────
  source_topic text,                              -- pauta/tema pedido
  pillar text,
  cost_usd numeric(12,6) NOT NULL DEFAULT 0,
  generation_metadata jsonb NOT NULL DEFAULT '{}',

  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_blog_posts_org ON active.blog_posts(org_id);
CREATE INDEX idx_blog_posts_status ON active.blog_posts(org_id, status);
CREATE UNIQUE INDEX idx_blog_posts_org_slug ON active.blog_posts(org_id, slug);
-- índice do worker de agendamento (Fase 3): busca vencidos rápido
CREATE INDEX idx_blog_posts_scheduled ON active.blog_posts(scheduled_for)
  WHERE status = 'scheduled';

ALTER TABLE active.blog_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "blog_posts_org" ON active.blog_posts
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_blog_posts_updated_at
  BEFORE UPDATE ON active.blog_posts
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON active.blog_posts TO authenticated, service_role;

COMMENT ON TABLE active.blog_posts IS
  'Pipeline do blog GEO gerado por IA: rascunho/revisão/agendamento. Ao publicar grava no Sanity (canônico); o site público renderiza.';
