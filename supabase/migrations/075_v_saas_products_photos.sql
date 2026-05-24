-- Expõe TODAS as fotos + a descrição do produto na ponte de catálogo, pro
-- Social AI Studio poder (E1) deixar o usuário escolher qual imagem vira a
-- base do reel e (E2) enriquecer o roteiro com a descrição do produto.
--
-- `photos`: array com todas as fotos, forçando https (Instagram/Kling e a
-- página https recusam http). `description`: texto livre do produto.
-- Mantém todas as colunas anteriores (a bridge faz SELECT explícito delas).

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'products') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_products AS
      SELECT
        p.id,
        p.organization_id,
        p.ml_listing_id,
        COALESCE(p.ml_title, p.name)                          AS title,
        p.sku,
        p.price,
        p.cost_price                                          AS cost,
        p.stock                                               AS stock_quantity,
        p.category,
        regexp_replace(
          COALESCE(p.photo_urls[1], NULLIF((p.images->>0), '')),
          '^http://', 'https://'
        )                                                     AS thumbnail_url,
        p.status,
        p.platform                                            AS marketplace,
        NULL::numeric                                         AS margin_percent,
        p.attributes                                          AS metadata,
        p.created_at,
        p.updated_at,
        -- Colunas NOVAS no fim (CREATE OR REPLACE VIEW exige manter a ordem).
        -- Todas as fotos (https forçado). Vazio → array vazio.
        ARRAY(
          SELECT regexp_replace(u, '^http://', 'https://')
          FROM unnest(COALESCE(p.photo_urls, '{}'::text[])) AS u
          WHERE u IS NOT NULL AND u <> ''
        )                                                     AS photos,
        p.description                                         AS description
      FROM public.products p;
    $VIEW$;
    GRANT SELECT ON active.v_saas_products TO authenticated, service_role;
  END IF;
END $$;
