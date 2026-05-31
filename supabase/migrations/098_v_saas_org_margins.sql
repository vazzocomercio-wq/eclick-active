-- ═══════════════════════════════════════════════════════════════════
-- 098 — Bridge: margem REAL da org (SaaS) → Ads Agent (Active) — Financeiro Fase 4
--
-- Fecha o loop "financeiro guia o anúncio": o motor de DRE (SaaS) sabe a
-- margem de contribuição REAL por org (de public.orders, motor de margem). Esta
-- view expõe a margem blended dos últimos 60d + a meta de líquido consolidado,
-- pro AdsAnalyzeService do Active derivar o ACOS-alvo do especialista ML em vez
-- de usar o min_campaign_margin_pct estático.
--
-- Read-only, passthrough organization_id = ID da org NO SAAS (o provider ML usa
-- credential_ref = saas_org). Mesma instância Supabase. Padrão 083/090/097.
-- ═══════════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'orders') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_org_margins AS
      SELECT
        o.organization_id,
        round(
          (sum(o.contribution_margin) / NULLIF(sum(o.sale_price * o.quantity), 0) * 100)::numeric,
          2
        ) AS contribution_margin_pct,
        count(*)                       AS orders_60d,
        org.target_net_margin_pct
      FROM public.orders o
      JOIN public.organizations org ON org.id = o.organization_id
      WHERE o.status <> 'cancelled'
        AND o.contribution_margin IS NOT NULL
        AND o.sold_at >= (now() - interval '60 days')
      GROUP BY o.organization_id, org.target_net_margin_pct;
    $VIEW$;
    GRANT SELECT ON active.v_saas_org_margins TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_org_margins criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_org_margins AS
      SELECT NULL::uuid AS organization_id, NULL::numeric AS contribution_margin_pct,
             NULL::bigint AS orders_60d, NULL::numeric AS target_net_margin_pct
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_org_margins TO authenticated, service_role;
    RAISE NOTICE 'bridge: orders ausente — view vazia';
  END IF;
END $$;
