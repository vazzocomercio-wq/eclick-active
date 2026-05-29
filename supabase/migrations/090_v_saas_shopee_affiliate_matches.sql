-- ═══════════════════════════════════════════════════
-- 090: Bridge — afiliados parceiros Shopee pro CRM do Active (F18 F4.4)
--
-- A Ponte (Matchmaker, schema shopee no SaaS) conecta vendedor↔afiliado.
-- Quando o afiliado ACEITA a proposta (match_offers.status accepted/active),
-- ele vira um "parceiro" que o CRM do Active deve enxergar como contato/lead.
--
-- Esta view expõe os matches aceitos + dados do perfil do afiliado numa
-- view active.* read-only. O Active consome pra: (a) listar parceiros
-- Shopee, (b) criar active.contacts + active.deals "Parceria Shopee".
--
-- Read-only. Tolerante a ambiente sem o schema shopee. Mesma instância
-- Supabase (não duplica dados). Espelha o padrão de 083_v_saas_tiktok.
-- ═══════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'shopee' AND table_name = 'match_offers') THEN
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_shopee_affiliate_matches AS
      SELECT
        m.id                                       AS match_id,
        m.organization_id,
        m.seller_shop_id,
        m.item_id,
        m.affiliate_profile_id,
        p.display_name                             AS affiliate_name,
        p.niches,
        p.channels,
        p.reach_estimate,
        p.avg_conversion_rate,
        m.proposed_commission_pct,
        m.match_score,
        m.status,
        m.created_at,
        m.responded_at,
        -- shape de contato pro CRM reaproveitar (nome + canal primário)
        COALESCE(p.channels[1], 'shopee')          AS primary_channel,
        'shopee_affiliate'::text                   AS source
      FROM shopee.match_offers m
      LEFT JOIN shopee.affiliate_profiles p ON p.id = m.affiliate_profile_id
      WHERE m.status IN ('accepted', 'active');
    $VIEW$;
    GRANT SELECT ON active.v_saas_shopee_affiliate_matches TO authenticated, service_role;
    RAISE NOTICE 'bridge: v_saas_shopee_affiliate_matches criada';
  ELSE
    EXECUTE $VIEW$
      CREATE OR REPLACE VIEW active.v_saas_shopee_affiliate_matches AS
      SELECT
        NULL::uuid        AS match_id,
        NULL::uuid        AS organization_id,
        NULL::bigint      AS seller_shop_id,
        NULL::bigint      AS item_id,
        NULL::uuid        AS affiliate_profile_id,
        NULL::text        AS affiliate_name,
        NULL::text[]      AS niches,
        NULL::text[]      AS channels,
        NULL::integer     AS reach_estimate,
        NULL::numeric     AS avg_conversion_rate,
        NULL::numeric     AS proposed_commission_pct,
        NULL::smallint    AS match_score,
        NULL::text        AS status,
        NULL::timestamptz AS created_at,
        NULL::timestamptz AS responded_at,
        NULL::text        AS primary_channel,
        NULL::text        AS source
      WHERE false;
    $VIEW$;
    GRANT SELECT ON active.v_saas_shopee_affiliate_matches TO authenticated, service_role;
    RAISE NOTICE 'bridge: schema shopee ausente — view vazia';
  END IF;
END $$;
