-- ═══════════════════════════════════════════════════════════════════
-- 099 — Bridge ML Ads: expõe acos_target + strategy (write Fase 3)
--
-- O motor (Active) passa a APLICAR decisões de Mercado Livre. A alavanca
-- primária do Product Ads é o ACOS-alvo (acos_target) — muitas campanhas PADS
-- têm daily_budget = null. O SaaS agora captura acos_target/strategy no sync
-- (mig 20260687); esta view repassa pro motor montar before/after e rollback.
--
-- ⚠️ CREATE OR REPLACE VIEW NÃO permite reordenar colunas — só ACRESCENTAR no
-- fim. Por isso acos_target/strategy entram DEPOIS de synced_at (a view de 097
-- já existe com as 10 primeiras colunas nessa ordem). NOTIFY no fim recarrega
-- o schema cache do PostgREST.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'ml_ads_campaigns') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_campaigns AS
      SELECT id, organization_id, advertiser_id, name, status,
             daily_budget, type, start_date, end_date, synced_at,
             acos_target, strategy
      FROM public.ml_ads_campaigns;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_campaigns TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_ml_ads_campaigns recriada com acos_target/strategy';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_ml_ads_campaigns AS
      SELECT NULL::text AS id, NULL::uuid AS organization_id, NULL::text AS advertiser_id,
             NULL::text AS name, NULL::text AS status, NULL::numeric AS daily_budget,
             NULL::text AS type, NULL::text AS start_date, NULL::text AS end_date,
             NULL::timestamptz AS synced_at,
             NULL::numeric AS acos_target, NULL::text AS strategy
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_ml_ads_campaigns TO authenticated, service_role;
    RAISE NOTICE 'bridge: ml_ads_campaigns ausente — view vazia (c/ acos_target)';
  END IF;
END $$;

-- recarrega o schema cache do PostgREST
NOTIFY pgrst, 'reload schema';
