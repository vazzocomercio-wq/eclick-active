-- ═══════════════════════════════════════════════════════════════════
-- 100 — Bridge ML Ads NÍVEL-ANÚNCIO + tipos de decisão de anúncio
--       (F12 ML Fase 4 — copiloto)
--
-- (1) View active.v_saas_ml_ads_items: repassa public.ml_ads_items (snapshot
--     por anúncio que o SaaS coleta no sync, mig 20260688) pro motor do Active
--     decidir no nível de ANÚNCIO. Padrão das migs 097/098/099 (branch
--     tabela-existe + branch vazio, tolerante a ambiente sem a tabela).
--
-- (2) ads_decisions.type ganha pause_ad / remove_ad / boost_ad — as decisões
--     de nível-anúncio. São SEMPRE copiloto (write no Product Ads do ML está
--     bloqueado, 401 mclics): viram card + deep-link pro painel, sem apply.
--
-- NOTIFY no fim recarrega o schema cache do PostgREST (a view nova + o GRANT).
-- ═══════════════════════════════════════════════════════════════════

-- (1) view-ponte do snapshot de anúncios ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ml_ads_items') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_items AS
      SELECT organization_id, item_id, advertiser_id, campaign_id, ad_group_id,
             title, price, permalink, thumbnail, status, recommended, domain_id,
             clicks, prints, cost, units_quantity, total_amount, acos, roas, ctr,
             metrics_days, synced_at
      FROM public.ml_ads_items;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_items TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_ml_ads_items criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_items AS
      SELECT NULL::uuid AS organization_id, NULL::text AS item_id,
             NULL::text AS advertiser_id, NULL::text AS campaign_id,
             NULL::text AS ad_group_id, NULL::text AS title, NULL::numeric AS price,
             NULL::text AS permalink, NULL::text AS thumbnail, NULL::text AS status,
             NULL::boolean AS recommended, NULL::text AS domain_id,
             NULL::numeric AS clicks, NULL::numeric AS prints, NULL::numeric AS cost,
             NULL::numeric AS units_quantity, NULL::numeric AS total_amount,
             NULL::numeric AS acos, NULL::numeric AS roas, NULL::numeric AS ctr,
             NULL::int AS metrics_days, NULL::timestamptz AS synced_at
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_items TO authenticated, service_role;
    RAISE NOTICE 'bridge: ml_ads_items ausente — view vazia';
  END IF;
END $$;

-- (2) novos tipos de decisão de NÍVEL-ANÚNCIO ───────────────────────
ALTER TABLE active.ads_decisions DROP CONSTRAINT IF EXISTS ads_decisions_type_check;
ALTER TABLE active.ads_decisions ADD CONSTRAINT ads_decisions_type_check
  CHECK (type IN (
    'scale_budget','reduce_budget','pause','activate','adjust_bid','reallocate',
    'pause_ad','remove_ad','boost_ad'));

-- recarrega o schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
