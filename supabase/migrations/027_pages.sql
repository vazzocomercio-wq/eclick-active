-- ============================================================
-- 027: Páginas (Landing Pages + Lojas) — AI-First Page Builder
-- ============================================================
-- Páginas web públicas geradas (manualmente OU por IA) e publicadas
-- em /p/:slug. Tipos: landing, store, booking, link_in_bio, sales_page,
-- thank_you. Blocks são definições JSON renderizadas em HTML estático
-- otimizado no momento do publish (rápido para SEO + performance).
-- ============================================================

CREATE TABLE IF NOT EXISTS active.pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  -- Slug usado em /p/:slug — único por org
  slug text NOT NULL,
  page_type text NOT NULL DEFAULT 'landing'
    CHECK (page_type IN ('landing', 'store', 'booking', 'link_in_bio', 'sales_page', 'thank_you')),
  -- Array de PageBlock (estrutura em packages/shared)
  blocks jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Estilos globais: cor primária/secundária, fonte heading/body, border radius
  global_styles jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- SEO: title, description, og_image, og_title, og_description, favicon
  seo jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Settings: tracking scripts, redirect_url, whatsapp config, store config
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'paused', 'archived')),
  custom_domain text,
  -- HTML estático compilado no publish — servido no /p/:slug
  published_html text,
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  template_id text,
  ai_generated boolean NOT NULL DEFAULT false,
  -- Metadata: ai_prompt usado, dados de geração, etc
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Stats agregados (atualizados periodicamente — evita JOIN em listagem)
  visits_count integer NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  conversions_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_pages_org ON active.pages (org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pages_slug_active ON active.pages (org_id, slug)
  WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_pages_type ON active.pages (org_id, page_type, status);

-- ────────────────────────────────────────────────────────────
-- page_visits — analytics de tráfego
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.page_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES active.pages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  -- visitor_id é fingerprint client-side (cookie/localStorage), session_id é por aba
  visitor_id text,
  session_id text,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  referrer text,
  device text CHECK (device IN ('desktop', 'mobile', 'tablet')),
  browser text,
  country text,
  city text,
  -- Engajamento
  duration_seconds integer,
  scroll_depth_pct integer,
  pages_viewed integer NOT NULL DEFAULT 1,
  -- Conversões observadas durante a visita
  form_submitted boolean NOT NULL DEFAULT false,
  product_viewed text[],
  cart_created boolean NOT NULL DEFAULT false,
  order_completed boolean NOT NULL DEFAULT false,
  order_value numeric(12,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_visits_page ON active.page_visits (page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_org ON active.page_visits (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_page_visits_utm ON active.page_visits (org_id, utm_source, utm_campaign)
  WHERE utm_source IS NOT NULL;

-- ────────────────────────────────────────────────────────────
-- store_products — produtos de lojas (page_type = 'store')
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.store_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES active.pages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  -- Vínculo opcional com products_catalog do CRM
  catalog_product_id uuid REFERENCES active.products_catalog(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  price numeric(12,2) NOT NULL,
  -- Preço "de" (riscado) — para mostrar desconto
  compare_at_price numeric(12,2),
  currency text NOT NULL DEFAULT 'BRL',
  -- Array de URLs de imagens
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Variantes: [{ name: 'Tamanho', options: ['P','M','G'] }, { name: 'Cor', options: ['Azul'] }]
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  category text,
  sku text,
  stock_quantity integer,
  is_active boolean NOT NULL DEFAULT true,
  position integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_products_page ON active.store_products (page_id, position);
CREATE INDEX IF NOT EXISTS idx_store_products_org ON active.store_products (org_id);
CREATE INDEX IF NOT EXISTS idx_store_products_active ON active.store_products (page_id, is_active, position)
  WHERE is_active = true;

-- ────────────────────────────────────────────────────────────
-- store_orders — pedidos
-- ────────────────────────────────────────────────────────────

-- order_number sequencial por org (não global) — pra ficar bonito tipo #1, #2, #3
CREATE SEQUENCE IF NOT EXISTS active.store_orders_number_seq;

CREATE TABLE IF NOT EXISTS active.store_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES active.pages(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES active.deals(id) ON DELETE SET NULL,
  -- Número incremental — facilita comunicar com cliente ("Pedido #42")
  order_number integer NOT NULL DEFAULT nextval('active.store_orders_number_seq'),
  -- Items: [{ product_id, name, price, quantity, variant_label, image }]
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric(12,2) NOT NULL,
  shipping numeric(12,2) NOT NULL DEFAULT 0,
  discount numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  customer_name text,
  customer_email text,
  customer_phone text,
  -- { cep, street, number, complement, neighborhood, city, state }
  customer_address jsonb,
  payment_method text,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  fulfillment_status text NOT NULL DEFAULT 'unfulfilled'
    CHECK (fulfillment_status IN ('unfulfilled', 'processing', 'shipped', 'delivered', 'cancelled')),
  notes text,
  utm_source text,
  utm_campaign text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_store_orders_page ON active.store_orders (page_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_org ON active.store_orders (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_store_orders_contact ON active.store_orders (contact_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_store_orders_status ON active.store_orders (org_id, payment_status, fulfillment_status);

-- ────────────────────────────────────────────────────────────
-- RLS
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.page_visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.store_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.store_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.pages;
CREATE POLICY "org_isolation" ON active.pages
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.page_visits;
CREATE POLICY "org_isolation" ON active.page_visits
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.store_products;
CREATE POLICY "org_isolation" ON active.store_products
  FOR ALL USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS "org_isolation" ON active.store_orders;
CREATE POLICY "org_isolation" ON active.store_orders
  FOR ALL USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- Triggers
-- ────────────────────────────────────────────────────────────

-- Atualiza visits_count no INSERT de page_visits
CREATE OR REPLACE FUNCTION active.increment_page_visits()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE active.pages
  SET
    visits_count = visits_count + 1,
    conversions_count = conversions_count
      + CASE WHEN NEW.form_submitted OR NEW.order_completed THEN 1 ELSE 0 END
  WHERE id = NEW.page_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_page_visit_count ON active.page_visits;
CREATE TRIGGER trg_page_visit_count
  AFTER INSERT ON active.page_visits
  FOR EACH ROW EXECUTE FUNCTION active.increment_page_visits();

-- Atualiza orders_count no INSERT de store_orders
CREATE OR REPLACE FUNCTION active.increment_page_orders()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE active.pages
  SET orders_count = orders_count + 1
  WHERE id = NEW.page_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_store_order_count ON active.store_orders;
CREATE TRIGGER trg_store_order_count
  AFTER INSERT ON active.store_orders
  FOR EACH ROW EXECUTE FUNCTION active.increment_page_orders();

-- updated_at triggers (usa active.set_updated_at se existir)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at' AND pronamespace = 'active'::regnamespace
  ) THEN
    DROP TRIGGER IF EXISTS trg_pages_updated_at ON active.pages;
    EXECUTE 'CREATE TRIGGER trg_pages_updated_at BEFORE UPDATE ON active.pages FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';

    DROP TRIGGER IF EXISTS trg_store_products_updated_at ON active.store_products;
    EXECUTE 'CREATE TRIGGER trg_store_products_updated_at BEFORE UPDATE ON active.store_products FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';

    DROP TRIGGER IF EXISTS trg_store_orders_updated_at ON active.store_orders;
    EXECUTE 'CREATE TRIGGER trg_store_orders_updated_at BEFORE UPDATE ON active.store_orders FOR EACH ROW EXECUTE FUNCTION active.set_updated_at()';
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
