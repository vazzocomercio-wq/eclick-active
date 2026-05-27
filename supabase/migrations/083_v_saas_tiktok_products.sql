-- ═══════════════════════════════════════════════════
-- 083: Bridge — produtos do TikTok Shop pro Social AI Studio (TS-P4)
--
-- Espelha public.tiktok_shop_products (SaaS) numa view active.* com EXATAMENTE
-- as mesmas colunas de active.v_saas_products (SaasProduct), pra reaproveitar o
-- mesmo tipo/seletor no web — só muda a fonte. marketplace='tiktok_shop'.
--
-- O search do TikTok devolve produto "leve"; o import enriquece via detalhe
-- (imagem/descrição/preço/categoria) e guarda tudo em `raw`. Aqui extraímos:
--   thumbnail_url ← main_image_url (já https)
--   photos        ← urls[0] de cada main_image
--   description   ← raw.description
--   price/sku     ← raw.skus[0]
--   category      ← último elo de raw.category_chains (folha)
--
-- Read-only. Tolerante a ambiente sem a tabela. Mesma instância Supabase que
-- o schema public (não duplica dados).
-- ═══════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'tiktok_shop_products') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_tiktok_products AS
      SELECT
        tp.tts_product_id                                       AS id,
        tp.organization_id,
        NULL::text                                              AS ml_listing_id,
        tp.title,
        (tp.raw->'skus'->0->>'seller_sku')                      AS sku,
        NULLIF(tp.raw->'skus'->0->'price'->>'tax_exclusive_price','')::numeric
                                                                AS price,
        NULL::numeric                                           AS cost,
        NULLIF(tp.raw->'skus'->0->'inventory'->0->>'quantity','')::integer
                                                                AS stock_quantity,
        (tp.raw->'category_chains'->-1->>'local_name')          AS category,
        tp.main_image_url                                       AS thumbnail_url,
        tp.status,
        'tiktok_shop'::text                                     AS marketplace,
        NULL::numeric                                           AS margin_percent,
        tp.raw                                                  AS metadata,
        COALESCE(tp.synced_at, tp.updated_at)                   AS created_at,
        tp.updated_at,
        -- Todas as fotos principais (urls[0] de cada main_image). Vazio → {}.
        ARRAY(
          SELECT (mi->'urls'->>0)
          FROM jsonb_array_elements(COALESCE(tp.raw->'main_images', '[]'::jsonb)) AS mi
          WHERE (mi->'urls'->>0) IS NOT NULL AND (mi->'urls'->>0) <> ''
        )                                                       AS photos,
        NULLIF(tp.raw->>'description', '')                      AS description
      FROM public.tiktok_shop_products tp;
    $VIEW$;
    GRANT SELECT ON active.v_saas_tiktok_products TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_tiktok_products criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_tiktok_products AS
      SELECT
        NULL::text AS id, NULL::uuid AS organization_id, NULL::text AS ml_listing_id,
        NULL::text AS title, NULL::text AS sku, NULL::numeric AS price,
        NULL::numeric AS cost, NULL::integer AS stock_quantity, NULL::text AS category,
        NULL::text AS thumbnail_url, NULL::text AS status, NULL::text AS marketplace,
        NULL::numeric AS margin_percent, NULL::jsonb AS metadata,
        NULL::timestamptz AS created_at, NULL::timestamptz AS updated_at,
        NULL::text[] AS photos, NULL::text AS description
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_tiktok_products TO authenticated, service_role;
    RAISE NOTICE 'bridge: public.tiktok_shop_products ausente — view vazia';
  END IF;
END $$;
