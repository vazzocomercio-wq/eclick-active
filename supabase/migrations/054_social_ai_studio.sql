-- ═══════════════════════════════════════════════════
-- 054: Social AI Studio — fábrica de conteúdo com IA
-- Marcas + calendários editoriais + posts/carrosséis +
-- biblioteca de assets + templates de prompt.
-- ═══════════════════════════════════════════════════

-- ─── 1. social_brands ────────────────────────────
CREATE TABLE active.social_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  description text,

  -- Identidade visual
  primary_color text NOT NULL DEFAULT '#00E5FF',
  secondary_color text NOT NULL DEFAULT '#4ADE50',
  logo_url text,
  canva_brand_kit_id text,

  -- Linha editorial
  niche text,
  target_audience text,
  value_proposition text,
  pain_points text[] NOT NULL DEFAULT '{}',
  differentials text[] NOT NULL DEFAULT '{}',
  main_cta text,

  -- Tom e estilo
  tone_of_voice text NOT NULL DEFAULT 'professional',
  forbidden_words text[] NOT NULL DEFAULT '{}',
  preferred_words text[] NOT NULL DEFAULT '{}',
  emoji_usage text NOT NULL DEFAULT 'moderate'
    CHECK (emoji_usage IN ('none', 'minimal', 'moderate', 'heavy')),
  hashtag_strategy text NOT NULL DEFAULT 'mixed'
    CHECK (hashtag_strategy IN ('niche', 'broad', 'mixed', 'minimal')),

  -- Vínculos
  persona_id uuid,
  knowledge_categories text[] NOT NULL DEFAULT '{}',

  -- Inspirações
  inspiration_urls jsonb NOT NULL DEFAULT '[]',
  reference_accounts text[] NOT NULL DEFAULT '{}',

  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

CREATE INDEX idx_social_brands_org ON active.social_brands(org_id);
CREATE INDEX idx_social_brands_active ON active.social_brands(org_id) WHERE is_active = true;

CREATE TRIGGER trg_social_brands_updated_at
  BEFORE UPDATE ON active.social_brands
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. social_calendars ─────────────────────────
CREATE TABLE active.social_calendars (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES active.social_brands(id) ON DELETE CASCADE,
  name text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  channels text[] NOT NULL DEFAULT '{instagram}',
  objective text NOT NULL DEFAULT 'engagement' CHECK (objective IN (
    'reach', 'engagement', 'leads', 'sales', 'authority', 'launch', 'remarketing'
  )),
  frequency_per_week integer NOT NULL DEFAULT 5 CHECK (frequency_per_week BETWEEN 1 AND 14),
  content_mix jsonb NOT NULL DEFAULT
    '{"educational": 40, "promotional": 20, "social_proof": 20, "entertainment": 10, "institutional": 10}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'completed', 'archived')),
  generated_by_ai boolean NOT NULL DEFAULT true,
  ai_generation_prompt text,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_calendars_org ON active.social_calendars(org_id);
CREATE INDEX idx_social_calendars_brand ON active.social_calendars(brand_id);
CREATE INDEX idx_social_calendars_dates ON active.social_calendars(org_id, start_date, end_date);

CREATE TRIGGER trg_social_calendars_updated_at
  BEFORE UPDATE ON active.social_calendars
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 3. social_contents ──────────────────────────
CREATE TABLE active.social_contents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid NOT NULL REFERENCES active.social_brands(id) ON DELETE CASCADE,
  calendar_id uuid REFERENCES active.social_calendars(id) ON DELETE SET NULL,

  content_type text NOT NULL CHECK (content_type IN (
    'post', 'carousel', 'reel', 'story', 'tiktok', 'vsl', 'ugc'
  )),
  format_subtype text,

  title text,
  caption text,
  hashtags text[] NOT NULL DEFAULT '{}',
  cta text,

  media jsonb NOT NULL DEFAULT '[]',
  cover_image_url text,
  slides jsonb NOT NULL DEFAULT '[]',

  channels text[] NOT NULL DEFAULT '{instagram}',

  pillar text CHECK (pillar IN (
    'educational', 'promotional', 'social_proof', 'entertainment',
    'institutional', 'engagement', 'product', 'behind_scenes'
  )),
  campaign_tag text,
  related_product_id uuid,

  scheduled_for timestamptz,
  scheduled_channels text[],

  status text NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'generating', 'pending_approval', 'approved',
    'rejected', 'scheduled', 'published', 'failed'
  )),
  approved_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  approved_at timestamptz,
  rejection_reason text,

  version integer NOT NULL DEFAULT 1,
  parent_content_id uuid REFERENCES active.social_contents(id) ON DELETE SET NULL,

  ai_model text,
  ai_prompt text,
  ai_generation_time_ms integer,

  published_at timestamptz,
  external_post_ids jsonb NOT NULL DEFAULT '{}',
  performance_metrics jsonb NOT NULL DEFAULT '{}',

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_contents_org ON active.social_contents(org_id);
CREATE INDEX idx_social_contents_brand ON active.social_contents(brand_id);
CREATE INDEX idx_social_contents_calendar ON active.social_contents(calendar_id);
CREATE INDEX idx_social_contents_status ON active.social_contents(org_id, status);
CREATE INDEX idx_social_contents_scheduled ON active.social_contents(org_id, scheduled_for)
  WHERE status IN ('approved', 'scheduled');
CREATE INDEX idx_social_contents_type ON active.social_contents(org_id, content_type);
CREATE INDEX idx_social_contents_pending ON active.social_contents(org_id)
  WHERE status = 'pending_approval';

CREATE TRIGGER trg_social_contents_updated_at
  BEFORE UPDATE ON active.social_contents
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 4. social_prompt_templates ──────────────────
CREATE TABLE active.social_prompt_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  content_type text NOT NULL,
  pillar text,
  prompt_template text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  is_system boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_prompts_org ON active.social_prompt_templates(org_id);
CREATE INDEX idx_social_prompts_system ON active.social_prompt_templates(is_system)
  WHERE is_system = true;

-- ─── 5. social_assets ────────────────────────────
CREATE TABLE active.social_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brand_id uuid REFERENCES active.social_brands(id) ON DELETE SET NULL,
  name text NOT NULL,
  asset_type text NOT NULL DEFAULT 'image'
    CHECK (asset_type IN ('image', 'video', 'audio', 'template', 'inspiration')),
  url text NOT NULL,
  thumbnail_url text,
  source text NOT NULL DEFAULT 'generated_ai'
    CHECK (source IN ('generated_ai', 'canva', 'upload', 'inspiration_url', 'placeholder')),
  ai_provider text,
  width integer,
  height integer,
  used_in_contents uuid[] NOT NULL DEFAULT '{}',
  tags text[] NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_assets_org ON active.social_assets(org_id);
CREATE INDEX idx_social_assets_brand ON active.social_assets(brand_id);
CREATE INDEX idx_social_assets_type ON active.social_assets(org_id, asset_type);

-- ─── 6. RLS ──────────────────────────────────────
ALTER TABLE active.social_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_contents ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_prompt_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.social_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_brands_org" ON active.social_brands
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_calendars_org" ON active.social_calendars
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_contents_org" ON active.social_contents
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "social_prompts_org" ON active.social_prompt_templates
  FOR ALL USING (
    is_system = true OR org_id = active.get_user_org_id()
  );
CREATE POLICY "social_assets_org" ON active.social_assets
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 7. Realtime ─────────────────────────────────
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.social_contents;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE active.social_contents REPLICA IDENTITY DEFAULT;

-- ─── 8. Seed prompt templates do sistema ────────
INSERT INTO active.social_prompt_templates
  (org_id, name, content_type, pillar, prompt_template, variables, is_system)
VALUES
  (NULL, 'Post Educativo', 'post', 'educational',
   'Crie um post educativo sobre {{tema}} no nicho de {{nicho}}. Estrutura: pergunta provocativa → 3 fatos surpreendentes → conclusão acionável → CTA.',
   '{tema, nicho}', true),
  (NULL, 'Post Promocional', 'post', 'promotional',
   'Crie um post promocional do produto {{produto}} com benefício principal {{beneficio}} e oferta {{oferta}}. Use prova social se disponível. CTA forte.',
   '{produto, beneficio, oferta}', true),
  (NULL, 'Post de Prova Social', 'post', 'social_proof',
   'Post de depoimento/case com cliente real {{cliente}} resultado {{resultado}}. Emocional, autêntico.',
   '{cliente, resultado}', true),
  (NULL, 'Post de Engajamento', 'post', 'engagement',
   'Post curto que faz pergunta intrigante sobre {{tema}} para gerar comentários.',
   '{tema}', true),
  (NULL, 'Carrossel Tutorial', 'carousel', 'educational',
   'Crie um carrossel de 7 slides ensinando {{tema}}. Slide 1: capa impactante. Slides 2-6: passos detalhados. Slide 7: CTA.',
   '{tema}', true),
  (NULL, 'Carrossel Storytelling', 'carousel', 'engagement',
   'Carrossel narrativo sobre {{tema}}. Estrutura: gancho → conflito → desenvolvimento → solução → resultado → CTA.',
   '{tema}', true),
  (NULL, 'Carrossel Lista', 'carousel', 'educational',
   'Carrossel em formato de lista numerada sobre {{tema}}. Capa com promessa clara, slides com itens da lista (1 por slide), slide final com CTA.',
   '{tema}', true),
  (NULL, 'Carrossel Antes e Depois', 'carousel', 'social_proof',
   'Carrossel antes/depois sobre {{transformacao}}. Capa: pergunta-isca. Slides: situação inicial → processo → resultado. Final: CTA.',
   '{transformacao}', true);

-- ─── 9. Storage bucket pra assets do social ─────
-- Bucket privado; signed URLs via service-role no backend.
-- Policy de SELECT pra org via UI direta fica em migration 055 (aplicada manualmente
-- no Supabase Studio, mesmo padrão do bucket message-media — vide M038).
INSERT INTO storage.buckets (id, name, public)
VALUES ('social-media', 'social-media', false)
ON CONFLICT (id) DO NOTHING;

-- ─── 10. Grants ──────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_brands TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_calendars TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_contents TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_prompt_templates TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_assets TO authenticated, service_role;
