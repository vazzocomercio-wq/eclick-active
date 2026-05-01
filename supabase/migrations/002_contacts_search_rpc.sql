-- ============================================================
-- e-Click Active — Migration 002: Contacts full-text search RPC
-- Schema: active
-- Date: 2026-05-01
-- Description: Função search_contacts(p_org_id, p_query, p_limit)
--              que aproveita o índice GIN tsvector criado em 001
--              (idx_contacts_search). Retorna SETOF active.contacts
--              ordenado por ts_rank.
-- ============================================================

CREATE OR REPLACE FUNCTION active.search_contacts(
  p_org_id uuid,
  p_query  text,
  p_limit  int DEFAULT 20
)
RETURNS SETOF active.contacts
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = active, public
AS $$
  -- IMPORTANTE: a expressão `to_tsvector(...)` aqui precisa ser BYTE-A-BYTE
  -- idêntica à do índice idx_contacts_search criado em 001 — caso contrário
  -- o planner não usa o GIN e cai pra seq scan.
  SELECT c.*
  FROM active.contacts c
  WHERE c.org_id = p_org_id
    AND to_tsvector(
          'portuguese',
          coalesce(c.name, '')  || ' ' ||
          coalesce(c.phone, '') || ' ' ||
          coalesce(c.email, '')
        ) @@ plainto_tsquery('portuguese', p_query)
  ORDER BY ts_rank(
    to_tsvector(
      'portuguese',
      coalesce(c.name, '')  || ' ' ||
      coalesce(c.phone, '') || ' ' ||
      coalesce(c.email, '')
    ),
    plainto_tsquery('portuguese', p_query)
  ) DESC,
  c.updated_at DESC
  LIMIT greatest(1, least(p_limit, 100));
$$;

COMMENT ON FUNCTION active.search_contacts(uuid, text, int) IS
'Full-text search em contacts (name + phone + email) usando o índice GIN
idx_contacts_search. SECURITY INVOKER — quando chamado por usuário
autenticado a RLS de active.contacts é aplicada; quando chamado por
service-role o backend é responsável pela isolação por org_id.';

-- Permissões: por padrão funções em schemas custom não são executáveis
-- por roles anon/authenticated do Supabase. Service-role (usado pelo
-- backend) ignora isso. Descomente abaixo se quiser permitir chamada
-- direta do frontend autenticado:
--
-- GRANT EXECUTE ON FUNCTION active.search_contacts(uuid, text, int)
--   TO authenticated;
