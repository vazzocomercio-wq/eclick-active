-- Ponte de catálogo (Social AI Studio catalog-aware).
--
-- A view active.v_saas_products (M052) mapeava thumbnail_url de p.images,
-- mas as fotos do SaaS estão em public.products.photo_urls (text[]) →
-- thumbnail vinha sempre null. Corrige pra priorizar photo_urls[1].
--
-- (O mapeamento active.organizations.saas_org_id por org é DADO, setado
--  fora de migration por ser específico de cada tenant.)

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
        -- força https: Instagram recusa imagens http (fotos do ML vêm http)
        regexp_replace(
          COALESCE(p.photo_urls[1], NULLIF((p.images->>0), '')),
          '^http://', 'https://'
        )                                                     AS thumbnail_url,
        p.status,
        p.platform                                            AS marketplace,
        NULL::numeric                                         AS margin_percent,
        p.attributes                                          AS metadata,
        p.created_at,
        p.updated_at
      FROM public.products p;
    $VIEW$;
    GRANT SELECT ON active.v_saas_products TO authenticated, service_role;
  END IF;
END $$;
