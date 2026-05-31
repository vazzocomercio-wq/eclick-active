-- ═══════════════════════════════════════════════════════════════════
-- 097 — Bridge: ML Ads do SaaS → Active (F12 — 3º adaptador, ML)
--
-- O SaaS (eclick-backend, módulo ml-ads) JÁ coleta ML Product/Brand/Display
-- Ads: campanhas em public.ml_ads_campaigns e métricas diárias em
-- public.ml_ads_reports (cron 6h, com WRITE via updateCampaign). O motor do
-- Ads Performance Agent (Active) lê esses dados via estas views read-only, em
-- vez de reimplementar a API de ML Ads.
--
-- Passthrough de organization_id = ID da org NO SAAS. O MercadoLivreAdsProvider
-- resolve active.organizations.saas_org_id e filtra por ele. Mesma instância
-- Supabase (não duplica dados). Padrão de 083/090 (v_saas_*). Tolerante a
-- ambiente sem as tabelas ml_ads_*.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ml_ads_campaigns') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_campaigns AS
      SELECT id, organization_id, advertiser_id, name, status,
             daily_budget, type, start_date, end_date, synced_at
      FROM public.ml_ads_campaigns;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_campaigns TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_ml_ads_campaigns criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_campaigns AS
      SELECT NULL::text AS id, NULL::uuid AS organization_id, NULL::text AS advertiser_id,
             NULL::text AS name, NULL::text AS status, NULL::numeric AS daily_budget,
             NULL::text AS type, NULL::text AS start_date, NULL::text AS end_date,
             NULL::timestamptz AS synced_at
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_campaigns TO authenticated, service_role;
    RAISE NOTICE 'bridge: ml_ads_campaigns ausente — view vazia';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ml_ads_reports') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_reports AS
      SELECT organization_id, campaign_id, date, clicks, impressions, ctr,
             spend, conversions, revenue, roas, acos
      FROM public.ml_ads_reports;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_reports TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_ml_ads_reports criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_reports AS
      SELECT NULL::uuid AS organization_id, NULL::text AS campaign_id, NULL::date AS date,
             NULL::numeric AS clicks, NULL::numeric AS impressions, NULL::numeric AS ctr,
             NULL::numeric AS spend, NULL::numeric AS conversions, NULL::numeric AS revenue,
             NULL::numeric AS roas, NULL::numeric AS acos
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_reports TO authenticated, service_role;
    RAISE NOTICE 'bridge: ml_ads_reports ausente — view vazia';
  END IF;
END $$;
