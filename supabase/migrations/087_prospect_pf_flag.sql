-- ═══════════════════════════════════════════════════════════════════
-- 087: e-Click Prospect — flag de PF cold collection por org
--
-- CONTEXTO: jurídico da Vazzo aprovou (2026-05-28) uso de dados PF em
-- coleta fria PRA USO INTERNO da empresa Vazzo/e-Click. Outras orgs do
-- SaaS continuam SEM essa permissão (precisam de validação jurídica
-- própria + flag setada manualmente).
--
-- Mecânica:
--  • Flag boolean default=false → PF cold continua bloqueado por padrão.
--  • Vazzo (org 98ea944c-50bd-424d-9a57-d00a87a9525b) recebe true neste
--    migration.
--  • Backend valida via RPC public.prospect_is_pf_cold_enabled antes de
--    aceitar collect com entity_type='pf'.
--
-- ⚠️ Importante:
--  • Coleta fria de PF ainda exige opt-out funcional (endpoint público
--    /public/prospect/opt-out já existe — não vaza presença/ausência).
--  • Guard de menores: enrichment futuro descarta entity se idade<18.
--  • Restrição "uso interno": pra ativar em outra org, exige documentação
--    jurídica + UPDATE explícito desta flag.
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE active.organizations
  ADD COLUMN IF NOT EXISTS prospect_pf_cold_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN active.organizations.prospect_pf_cold_enabled IS
  'Org pode coletar PF a frio? Default false. Habilitar EXIGE validação jurídica + UPDATE explícito.';

-- ───────────────────────────────────────────────────────────────────
-- Vazzo Comércio — habilitado (jurídico aprovou 2026-05-28)
-- ───────────────────────────────────────────────────────────────────
UPDATE active.organizations
SET prospect_pf_cold_enabled = true
WHERE id = '98ea944c-50bd-424d-9a57-d00a87a9525b';

-- ───────────────────────────────────────────────────────────────────
-- RPC: prospect_is_pf_cold_enabled
-- Backend chama antes de aceitar collect PF. SECURITY DEFINER pra
-- bypassar RLS (a tabela organizations é multi-tenant; queremos só
-- checar a flag da org passada).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prospect_is_pf_cold_enabled(p_org_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(prospect_pf_cold_enabled, false)
  FROM active.organizations
  WHERE id = p_org_id;
$$;

GRANT EXECUTE ON FUNCTION public.prospect_is_pf_cold_enabled(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.prospect_is_pf_cold_enabled IS
  'Retorna se a org tem permissão pra coletar PF a frio. False = bloqueia no collect.';

NOTIFY pgrst, 'reload schema';
