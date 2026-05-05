-- ═══════════════════════════════════════════════════
-- 052: Bridge Cross-Schema (public SaaS → active CRM)
-- Read-only. Tolerante a ambientes sem SaaS.
--
-- Os dois schemas (public SaaS, active Active) compartilham a mesma
-- instância Supabase. Esta bridge dá ao Active acesso read-only aos
-- dados operacionais do SaaS — sem duplicar tabelas e SEM quebrar
-- quando o SaaS não está presente.
--
-- Mapeamento ao schema REAL do SaaS (orders/products diferem do spec):
--   marketplace_order_id  ← orders.external_order_id
--   marketplace           ← orders.platform
--   total_amount          ← orders.sale_price * quantity
--   buyer_nickname        ← orders.buyer_username
--   buyer_document        ← orders.buyer_doc_number
--   date_created          ← orders.sold_at  (fallback created_at)
--   shipping_tracking_*   ← orders.shipping_id
--   metadata              ← orders.raw_data
--   title                 ← products.ml_title (fallback name)
--   cost                  ← products.cost_price
--   stock_quantity        ← products.stock
--   marketplace           ← products.platform
-- Colunas inexistentes no SaaS real ficam como NULL::tipo.
--
-- NOTA: _admin_exec_sql já encapsula em transaction — não use BEGIN/COMMIT
-- aqui (causa "EXECUTE of transaction commands is not implemented").
-- ═══════════════════════════════════════════════════

-- Helper: testa existência de tabela no schema public
CREATE OR REPLACE FUNCTION active._saas_table_exists(p_table text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = p_table
  );
$$;

-- ─── View 1: orders ───────────────────────────────
DO $$
BEGIN
  IF active._saas_table_exists('orders') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_orders AS
      SELECT
        o.id,
        o.organization_id,
        o.platform                         AS marketplace,
        o.external_order_id                AS marketplace_order_id,
        o.status,
        o.buyer_username                   AS buyer_nickname,
        o.buyer_email,
        o.buyer_phone,
        o.buyer_doc_number                 AS buyer_document,
        (COALESCE(o.sale_price, 0) * COALESCE(o.quantity, 1))::numeric
                                           AS total_amount,
        NULL::text                         AS currency_id,
        COALESCE(o.sold_at, o.created_at)  AS date_created,
        NULL::timestamptz                  AS date_closed,
        o.shipping_status,
        o.shipping_id::text                AS shipping_tracking_number,
        NULL::text                         AS shipping_carrier,
        NULL::timestamptz                  AS shipping_estimated_delivery,
        NULL::timestamptz                  AS shipping_actual_delivery,
        o.payment_status,
        NULL::text                         AS payment_method,
        NULL::jsonb                        AS items,
        NULL::text[]                       AS tags,
        o.notes,
        o.raw_data                         AS metadata,
        o.created_at,
        o.updated_at
      FROM public.orders o;
    $VIEW$;
    RAISE NOTICE 'bridge: v_saas_orders criada (mapeada ao schema real)';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_orders AS
      SELECT
        NULL::uuid AS id, NULL::uuid AS organization_id,
        NULL::text AS marketplace, NULL::text AS marketplace_order_id,
        NULL::text AS status, NULL::text AS buyer_nickname,
        NULL::text AS buyer_email, NULL::text AS buyer_phone,
        NULL::text AS buyer_document, NULL::numeric AS total_amount,
        NULL::text AS currency_id, NULL::timestamptz AS date_created,
        NULL::timestamptz AS date_closed, NULL::text AS shipping_status,
        NULL::text AS shipping_tracking_number, NULL::text AS shipping_carrier,
        NULL::timestamptz AS shipping_estimated_delivery,
        NULL::timestamptz AS shipping_actual_delivery,
        NULL::text AS payment_status, NULL::text AS payment_method,
        NULL::jsonb AS items, NULL::text[] AS tags, NULL::text AS notes,
        NULL::jsonb AS metadata, NULL::timestamptz AS created_at,
        NULL::timestamptz AS updated_at
      WHERE false;
    $VIEW$;
    RAISE NOTICE 'bridge: public.orders ausente — v_saas_orders criada vazia';
  END IF;
END $$;

-- ─── View 2: products ─────────────────────────────
DO $$
BEGIN
  IF active._saas_table_exists('products') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_products AS
      SELECT
        p.id,
        p.organization_id,
        p.ml_listing_id,
        COALESCE(p.ml_title, p.name)                     AS title,
        p.sku,
        p.price,
        p.cost_price                                     AS cost,
        p.stock                                          AS stock_quantity,
        p.category,
        NULLIF((p.images->>0), '')                       AS thumbnail_url,
        p.status,
        p.platform                                       AS marketplace,
        NULL::numeric                                    AS margin_percent,
        p.attributes                                     AS metadata,
        p.created_at,
        p.updated_at
      FROM public.products p;
    $VIEW$;
    RAISE NOTICE 'bridge: v_saas_products criada (mapeada ao schema real)';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_products AS
      SELECT
        NULL::uuid AS id, NULL::uuid AS organization_id,
        NULL::text AS ml_listing_id, NULL::text AS title, NULL::text AS sku,
        NULL::numeric AS price, NULL::numeric AS cost,
        NULL::integer AS stock_quantity, NULL::text AS category,
        NULL::text AS thumbnail_url, NULL::text AS status,
        NULL::text AS marketplace, NULL::numeric AS margin_percent,
        NULL::jsonb AS metadata, NULL::timestamptz AS created_at,
        NULL::timestamptz AS updated_at
      WHERE false;
    $VIEW$;
    RAISE NOTICE 'bridge: public.products ausente — v_saas_products criada vazia';
  END IF;
END $$;

-- ─── View 3: ml_questions (provavelmente ausente no SaaS atual) ──
DO $$
BEGIN
  IF active._saas_table_exists('ml_questions') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_questions AS
      SELECT
        q.id, q.organization_id, q.ml_question_id, q.ml_item_id, q.item_title,
        q.text AS question_text, q.status, q.answer_text, q.answer_status,
        q.from_buyer_nickname, q.date_created, q.answered_at,
        q.ai_suggested_answer, q.metadata, q.created_at
      FROM public.ml_questions q;
    $VIEW$;
    RAISE NOTICE 'bridge: v_saas_ml_questions criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_questions AS
      SELECT
        NULL::uuid AS id, NULL::uuid AS organization_id,
        NULL::text AS ml_question_id, NULL::text AS ml_item_id,
        NULL::text AS item_title, NULL::text AS question_text,
        NULL::text AS status, NULL::text AS answer_text,
        NULL::text AS answer_status, NULL::text AS from_buyer_nickname,
        NULL::timestamptz AS date_created, NULL::timestamptz AS answered_at,
        NULL::text AS ai_suggested_answer, NULL::jsonb AS metadata,
        NULL::timestamptz AS created_at
      WHERE false;
    $VIEW$;
    RAISE NOTICE 'bridge: public.ml_questions ausente — view criada vazia';
  END IF;
END $$;

-- ─── RPC: orders por contato (phone/email/nickname) ───
CREATE OR REPLACE FUNCTION active.get_saas_orders_by_contact(
  p_org_id uuid,
  p_phone text DEFAULT NULL,
  p_email text DEFAULT NULL,
  p_buyer_nickname text DEFAULT NULL,
  p_limit integer DEFAULT 20
)
RETURNS SETOF active.v_saas_orders
LANGUAGE sql STABLE AS $$
  SELECT * FROM active.v_saas_orders
  WHERE organization_id = p_org_id
    AND (
      (p_phone IS NOT NULL AND buyer_phone = p_phone)
      OR (p_email IS NOT NULL AND buyer_email = p_email)
      OR (p_buyer_nickname IS NOT NULL AND buyer_nickname = p_buyer_nickname)
    )
  ORDER BY date_created DESC NULLS LAST
  LIMIT GREATEST(p_limit, 1);
$$;

-- ─── RPC: produto por SKU ou ml_listing_id ────────
CREATE OR REPLACE FUNCTION active.get_saas_product(
  p_org_id uuid,
  p_sku text DEFAULT NULL,
  p_ml_listing_id text DEFAULT NULL
)
RETURNS SETOF active.v_saas_products
LANGUAGE sql STABLE AS $$
  SELECT * FROM active.v_saas_products
  WHERE organization_id = p_org_id
    AND (
      (p_sku IS NOT NULL AND sku = p_sku)
      OR (p_ml_listing_id IS NOT NULL AND ml_listing_id = p_ml_listing_id)
    )
  LIMIT 1;
$$;

-- ─── RPC: tem SaaS? (verifica existência da org em public.organizations) ──
CREATE OR REPLACE FUNCTION active.has_saas_integration(p_org_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_exists boolean := false;
BEGIN
  IF active._saas_table_exists('organizations') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.organizations WHERE id = $1)'
      INTO v_exists USING p_org_id;
  END IF;
  RETURN v_exists;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

-- ─── RPC: estatísticas resumidas de orders por org ────
CREATE OR REPLACE FUNCTION active.get_saas_order_stats(
  p_org_id uuid,
  p_since timestamptz DEFAULT (now() - interval '30 days')
)
RETURNS TABLE (
  total_orders bigint,
  delayed_orders bigint,
  delivered_orders bigint,
  total_revenue numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    COUNT(*)::bigint AS total_orders,
    COUNT(*) FILTER (
      WHERE shipping_estimated_delivery IS NOT NULL
        AND shipping_estimated_delivery < now()
        AND shipping_status NOT IN ('delivered', 'cancelled')
    )::bigint AS delayed_orders,
    COUNT(*) FILTER (WHERE shipping_status = 'delivered')::bigint AS delivered_orders,
    COALESCE(SUM(total_amount), 0)::numeric AS total_revenue
  FROM active.v_saas_orders
  WHERE organization_id = p_org_id
    AND date_created >= p_since;
$$;

-- ─── Grants ───────────────────────────────────────
GRANT SELECT ON active.v_saas_orders TO authenticated, service_role;
GRANT SELECT ON active.v_saas_products TO authenticated, service_role;
GRANT SELECT ON active.v_saas_ml_questions TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.get_saas_orders_by_contact TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.get_saas_product TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.has_saas_integration TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION active.get_saas_order_stats TO authenticated, service_role;
