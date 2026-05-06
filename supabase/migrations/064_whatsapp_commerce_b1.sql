-- ═══════════════════════════════════════════════════
-- 064: WhatsApp Commerce — B1 (Bridge catálogo)
-- View cross-schema lendo public.products + tabelas
-- locais: catalog_config, carts, orders, product_messages,
-- commerce_settings + mapping de org SaaS↔Active.
-- ═══════════════════════════════════════════════════

-- ─── 1. Mapping active.org_id ↔ public.org_id ────
-- Pré-requisito: org Active e org SaaS têm UUIDs diferentes.
-- Esta tabela liga as duas pra bridge funcionar.
CREATE TABLE IF NOT EXISTS active.saas_org_mapping (
  active_org_id uuid PRIMARY KEY REFERENCES active.organizations(id) ON DELETE CASCADE,
  saas_org_id uuid NOT NULL,
  saas_org_name text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(saas_org_id)
);

-- Seed: Vazzo Comércio (Active 98ea... ↔ SaaS 4ef1...)
INSERT INTO active.saas_org_mapping (active_org_id, saas_org_id, saas_org_name)
VALUES
  ('98ea944c-50bd-424d-9a57-d00a87a9525b',
   '4ef1aabd-c209-40b0-b034-ef69dcb66833',
   'Vazzo')
ON CONFLICT (active_org_id) DO NOTHING;

GRANT SELECT ON active.saas_org_mapping TO authenticated, service_role;
ALTER TABLE active.saas_org_mapping ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saas_org_mapping_org" ON active.saas_org_mapping
  FOR ALL USING (active_org_id = active.get_user_org_id());

-- ─── 2. View cross-schema: public.products ───────
-- Lê direto do SaaS. Service role tem acesso a public por default.
-- Adiciona campos calculados: in_stock, margin_pct, thumbnail_url.
CREATE OR REPLACE VIEW active.v_catalog_products AS
SELECT
  p.id AS product_id,
  p.organization_id AS saas_organization_id,
  p.name,
  p.sku,
  p.brand,
  p.category,
  p.description,
  p.ai_short_description AS short_description,
  p.price,
  p.cost_price,
  p.stock,
  p.condition,
  p.weight_kg,
  p.width_cm,
  p.height_cm,
  p.length_cm,
  p.photo_urls,
  p.images,
  p.gtin,
  p.model,
  p.differentials,
  p.bullets,
  p.technical_sheet,
  p.faq,
  p.tags,
  p.ai_seo_keywords AS seo_keywords,
  p.ai_target_audience AS target_audience,
  p.ai_score,
  (p.ai_enriched_at IS NOT NULL) AS ai_enriched,
  p.catalog_status,
  p.channel_titles,
  p.channel_descriptions,
  p.platforms AS published_channels,
  p.ml_item_id,
  p.ml_permalink,
  p.status,
  p.landing_published AS landing_page_enabled,
  p.landing_slug AS landing_page_slug,
  -- Campos calculados
  (p.stock > 0) AS in_stock,
  CASE
    WHEN p.price > 0 AND p.cost_price > 0
      THEN ROUND(((p.price - p.cost_price) / p.price * 100)::numeric, 1)
    ELSE NULL
  END AS margin_pct,
  -- Primeira imagem como thumbnail
  CASE
    WHEN p.photo_urls IS NOT NULL AND array_length(p.photo_urls, 1) > 0
      THEN p.photo_urls[1]
    WHEN p.images IS NOT NULL AND jsonb_array_length(p.images) > 0
      THEN p.images->0->>'url'
    ELSE NULL
  END AS thumbnail_url
FROM public.products p
WHERE p.status != 'archived';

GRANT SELECT ON active.v_catalog_products TO authenticated, service_role;

-- ─── 3. RPC: produtos do catálogo com mapping ────
-- Recebe active org_id, faz JOIN no mapping, retorna produtos da org SaaS.
CREATE OR REPLACE FUNCTION active.catalog_list_products(
  p_active_org_id uuid,
  p_query text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_min_price numeric DEFAULT NULL,
  p_max_price numeric DEFAULT NULL,
  p_in_stock_only boolean DEFAULT true,
  p_limit integer DEFAULT 20
)
RETURNS SETOF active.v_catalog_products
LANGUAGE sql STABLE AS $$
  SELECT v.*
  FROM active.v_catalog_products v
  JOIN active.saas_org_mapping m ON m.saas_org_id = v.saas_organization_id
  WHERE m.active_org_id = p_active_org_id
    AND m.is_active = true
    AND v.status != 'archived'
    AND (NOT p_in_stock_only OR v.in_stock)
    AND (
      p_query IS NULL OR p_query = ''
      OR v.name ILIKE '%' || p_query || '%'
      OR v.sku ILIKE '%' || p_query || '%'
      OR v.brand ILIKE '%' || p_query || '%'
      OR EXISTS (
        SELECT 1 FROM unnest(v.tags) tag
        WHERE tag ILIKE '%' || p_query || '%'
      )
    )
    AND (p_category IS NULL OR v.category = p_category)
    AND (p_min_price IS NULL OR v.price >= p_min_price)
    AND (p_max_price IS NULL OR v.price <= p_max_price)
  ORDER BY v.in_stock DESC, v.ai_score DESC NULLS LAST, v.name ASC
  LIMIT GREATEST(p_limit, 1);
$$;

CREATE OR REPLACE FUNCTION active.catalog_get_product(
  p_active_org_id uuid,
  p_product_id uuid
)
RETURNS SETOF active.v_catalog_products
LANGUAGE sql STABLE AS $$
  SELECT v.*
  FROM active.v_catalog_products v
  JOIN active.saas_org_mapping m ON m.saas_org_id = v.saas_organization_id
  WHERE m.active_org_id = p_active_org_id
    AND v.product_id = p_product_id
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION active.catalog_list_products TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.catalog_get_product TO authenticated, service_role;

-- ─── 4. whatsapp_catalog_config (config local) ───
CREATE TABLE active.whatsapp_catalog_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,                    -- FK lógica pra public.products

  whatsapp_enabled boolean NOT NULL DEFAULT true,
  whatsapp_message text,
  whatsapp_price_override numeric(12,2),

  max_quantity_per_order integer NOT NULL DEFAULT 10 CHECK (max_quantity_per_order > 0),
  min_quantity_per_order integer NOT NULL DEFAULT 1 CHECK (min_quantity_per_order > 0),
  allow_negotiation boolean NOT NULL DEFAULT false,
  negotiation_floor_price numeric(12,2),
  negotiation_rules jsonb NOT NULL DEFAULT '{}',

  whatsapp_category text,
  whatsapp_tags text[] NOT NULL DEFAULT '{}',
  featured boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,

  -- Métricas
  times_sent integer NOT NULL DEFAULT 0,
  times_added_to_cart integer NOT NULL DEFAULT 0,
  times_purchased integer NOT NULL DEFAULT 0,
  last_sent_at timestamptz,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, product_id)
);

CREATE INDEX idx_wa_catalog_org ON active.whatsapp_catalog_config(org_id);
CREATE INDEX idx_wa_catalog_enabled ON active.whatsapp_catalog_config(org_id) WHERE whatsapp_enabled = true;
CREATE INDEX idx_wa_catalog_featured ON active.whatsapp_catalog_config(org_id) WHERE featured = true;

CREATE TRIGGER trg_wa_catalog_updated_at
  BEFORE UPDATE ON active.whatsapp_catalog_config
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.whatsapp_catalog_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_catalog_config_org" ON active.whatsapp_catalog_config
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.whatsapp_catalog_config TO authenticated, service_role;

-- ─── 5. whatsapp_carts ───────────────────────────
CREATE TABLE active.whatsapp_carts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES active.contacts(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,

  items jsonb NOT NULL DEFAULT '[]',

  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  shipping_cost numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,

  coupon_code text,
  coupon_discount numeric(12,2) NOT NULL DEFAULT 0,

  shipping_method text,
  shipping_zip text,
  shipping_estimate_days integer,

  status text NOT NULL DEFAULT 'active' CHECK (status IN (
    'active', 'abandoned', 'recovered', 'converted', 'expired'
  )),
  abandoned_at timestamptz,
  recovered_at timestamptz,
  converted_at timestamptz,

  order_id uuid,
  payment_link text,
  payment_status text CHECK (payment_status IN (
    'pending', 'sent', 'paid', 'failed', 'refunded'
  )),

  last_interaction_at timestamptz NOT NULL DEFAULT now(),
  interaction_count integer NOT NULL DEFAULT 0,
  ai_assisted boolean NOT NULL DEFAULT false,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_carts_org ON active.whatsapp_carts(org_id);
CREATE INDEX idx_wa_carts_contact ON active.whatsapp_carts(contact_id);
CREATE INDEX idx_wa_carts_conversation ON active.whatsapp_carts(conversation_id);
CREATE INDEX idx_wa_carts_status ON active.whatsapp_carts(org_id, status);
CREATE INDEX idx_wa_carts_active_per_contact
  ON active.whatsapp_carts(contact_id) WHERE status = 'active';
CREATE INDEX idx_wa_carts_abandoned
  ON active.whatsapp_carts(org_id, abandoned_at) WHERE status = 'abandoned';

CREATE TRIGGER trg_wa_carts_updated_at
  BEFORE UPDATE ON active.whatsapp_carts
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.whatsapp_carts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_carts_org" ON active.whatsapp_carts
  FOR ALL USING (org_id = active.get_user_org_id());

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.whatsapp_carts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON active.whatsapp_carts TO authenticated, service_role;

-- ─── 6. whatsapp_orders ──────────────────────────
CREATE TABLE active.whatsapp_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES active.contacts(id) ON DELETE RESTRICT,
  conversation_id uuid REFERENCES active.conversations(id) ON DELETE SET NULL,
  cart_id uuid REFERENCES active.whatsapp_carts(id) ON DELETE SET NULL,

  -- Numeração sequencial por org via trigger
  order_number integer NOT NULL,
  display_number text NOT NULL,

  items jsonb NOT NULL DEFAULT '[]',

  subtotal numeric(12,2) NOT NULL,
  discount_total numeric(12,2) NOT NULL DEFAULT 0,
  shipping_cost numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL,
  coupon_code text,

  customer_name text,
  customer_phone text NOT NULL,
  customer_email text,

  shipping_address jsonb NOT NULL DEFAULT '{}',

  payment_method text CHECK (payment_method IN (
    'pix', 'credit_card', 'boleto', 'link', 'manual'
  )),
  payment_link text,
  payment_status text NOT NULL DEFAULT 'pending' CHECK (payment_status IN (
    'pending', 'paid', 'failed', 'refunded', 'cancelled'
  )),
  payment_id text,
  paid_at timestamptz,

  shipping_status text NOT NULL DEFAULT 'pending' CHECK (shipping_status IN (
    'pending', 'processing', 'shipped', 'in_transit', 'delivered', 'returned'
  )),
  tracking_code text,
  tracking_url text,
  shipped_at timestamptz,
  delivered_at timestamptz,

  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'confirmed', 'processing', 'shipped',
    'delivered', 'cancelled', 'refunded'
  )),

  internal_notes text,
  customer_notes text,

  saas_order_id uuid,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(org_id, order_number)
);

CREATE INDEX idx_wa_orders_org ON active.whatsapp_orders(org_id, created_at DESC);
CREATE INDEX idx_wa_orders_contact ON active.whatsapp_orders(contact_id);
CREATE INDEX idx_wa_orders_status ON active.whatsapp_orders(org_id, status);
CREATE INDEX idx_wa_orders_payment ON active.whatsapp_orders(org_id, payment_status);

CREATE TRIGGER trg_wa_orders_updated_at
  BEFORE UPDATE ON active.whatsapp_orders
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- Trigger: gera order_number sequencial por org + display_number
CREATE OR REPLACE FUNCTION active.wa_orders_set_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_number = 0 THEN
    SELECT COALESCE(MAX(order_number), 0) + 1
      INTO NEW.order_number
      FROM active.whatsapp_orders
      WHERE org_id = NEW.org_id;
  END IF;
  IF NEW.display_number IS NULL OR NEW.display_number = '' THEN
    NEW.display_number := 'WA-' || LPAD(NEW.order_number::text, 4, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_wa_orders_set_number
  BEFORE INSERT ON active.whatsapp_orders
  FOR EACH ROW EXECUTE FUNCTION active.wa_orders_set_number();

ALTER TABLE active.whatsapp_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_orders_org" ON active.whatsapp_orders
  FOR ALL USING (org_id = active.get_user_org_id());

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.whatsapp_orders;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON active.whatsapp_orders TO authenticated, service_role;

-- ─── 7. whatsapp_product_messages (templates) ────
CREATE TABLE active.whatsapp_product_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES active.organizations(id) ON DELETE CASCADE,

  name text NOT NULL,
  message_type text NOT NULL CHECK (message_type IN (
    'single_product', 'product_list', 'cart_summary',
    'order_confirmation', 'payment_link', 'tracking',
    'abandoned_cart', 'reorder', 'recommendation', 'review_request'
  )),

  template_text text NOT NULL,
  include_image boolean NOT NULL DEFAULT true,
  include_button boolean NOT NULL DEFAULT true,
  button_text text DEFAULT 'Ver produto',
  button_url_template text,

  is_default boolean NOT NULL DEFAULT false,
  is_system boolean NOT NULL DEFAULT false,
  usage_count integer NOT NULL DEFAULT 0,
  conversion_count integer NOT NULL DEFAULT 0,

  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wa_product_msgs_org ON active.whatsapp_product_messages(org_id, message_type);
CREATE INDEX idx_wa_product_msgs_system ON active.whatsapp_product_messages(message_type) WHERE is_system = true;

CREATE TRIGGER trg_wa_product_msgs_updated_at
  BEFORE UPDATE ON active.whatsapp_product_messages
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.whatsapp_product_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_product_msgs_org" ON active.whatsapp_product_messages
  FOR ALL USING (
    is_system = true OR org_id = active.get_user_org_id()
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON active.whatsapp_product_messages TO authenticated, service_role;

-- ─── 8. Seed: templates do sistema ───────────────
-- Estes templates são compartilhados (org_id NULL + is_system=true).
-- Cada org pode criar overrides.
INSERT INTO active.whatsapp_product_messages
  (org_id, name, message_type, template_text, is_default, is_system)
VALUES
  (NULL, 'Produto Individual', 'single_product',
   E'*{{product_name}}*\n\n{{description}}\n\n💰 *R$ {{price}}*\n{{stock_status}}\n\n{{bullets}}',
   true, true),
  (NULL, 'Resumo do Carrinho', 'cart_summary',
   E'🛒 *Seu carrinho*\n\n{{items_list}}━━━━━━━━━━━━\n💰 *Total: R$ {{total}}*\n\nDeseja finalizar a compra?',
   true, true),
  (NULL, 'Confirmação de Pedido', 'order_confirmation',
   E'✅ *Pedido {{order_number}} confirmado!*\n\nObrigado, {{customer_name}}!\n\n{{items_list}}💰 *Total: R$ {{total}}*\n💳 Pagamento: {{payment_method}}\n\nVocê receberá o código de rastreio assim que enviarmos. 📦',
   true, true),
  (NULL, 'Link de Pagamento', 'payment_link',
   E'💳 *Pagamento do pedido {{order_number}}*\n\n💰 Total: *R$ {{total}}*\n\nClique no link abaixo para pagar:\n{{payment_link}}\n\n⏰ Link válido por 24 horas.',
   true, true),
  (NULL, 'Rastreio', 'tracking',
   E'📦 *Pedido {{order_number}} enviado!*\n\nCódigo de rastreio: *{{tracking_code}}*\n\n🔍 Acompanhe: {{tracking_url}}\n\nPrazo estimado: {{shipping_estimate_days}} dias úteis.',
   true, true),
  (NULL, 'Carrinho Abandonado', 'abandoned_cart',
   E'Oi {{customer_name}}! 👋\n\nVi que você se interessou por:\n\n{{items_list}}\nPosso te ajudar a finalizar? 😊',
   true, true),
  (NULL, 'Recompra', 'reorder',
   E'Oi {{customer_name}}! 👋\n\nFaz um tempo que você comprou *{{product_name}}*.\n\nQuer pedir novamente? Posso preparar seu pedido rapidinho! 🚀',
   true, true),
  (NULL, 'Pedido de Avaliação', 'review_request',
   E'Oi {{customer_name}}! 😊\n\nSeu pedido {{order_number}} foi entregue. Como foi a experiência?\n\nDeixe sua avaliação: {{review_url}}\n\nObrigado pela confiança! 💙',
   true, true);

-- ─── 9. whatsapp_commerce_settings (config global org) ──
CREATE TABLE active.whatsapp_commerce_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL UNIQUE REFERENCES active.organizations(id) ON DELETE CASCADE,

  enabled boolean NOT NULL DEFAULT false,
  ai_seller_enabled boolean NOT NULL DEFAULT true,

  cart_expiry_minutes integer NOT NULL DEFAULT 1440,    -- 24h
  cart_abandon_minutes integer NOT NULL DEFAULT 30,
  auto_recover_abandoned boolean NOT NULL DEFAULT true,
  recovery_delay_minutes integer NOT NULL DEFAULT 60,

  payment_providers jsonb NOT NULL DEFAULT '[]',
  default_payment_method text NOT NULL DEFAULT 'pix',

  shipping_config jsonb NOT NULL DEFAULT '{}',

  ai_seller_persona text NOT NULL DEFAULT 'Você é um vendedor amigável e consultivo. Ajuda o cliente a encontrar o produto ideal, tira dúvidas, sugere combinações e facilita a compra. Seja direto mas cordial. Use emojis com moderação.',
  ai_seller_rules jsonb NOT NULL DEFAULT '{}',

  notify_on_order boolean NOT NULL DEFAULT true,
  notify_on_payment boolean NOT NULL DEFAULT true,
  notify_email text,
  notify_whatsapp text,

  -- Cupom genérico de recuperação
  recovery_coupon_code text,
  recovery_coupon_discount_pct integer,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_wa_commerce_settings_updated_at
  BEFORE UPDATE ON active.whatsapp_commerce_settings
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.whatsapp_commerce_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_commerce_settings_org" ON active.whatsapp_commerce_settings
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.whatsapp_commerce_settings TO authenticated, service_role;
