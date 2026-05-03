-- ============================================================
-- Migration 031: Reescreve search_contacts pra busca por substring
-- ============================================================
-- A versão original (002) usava plainto_tsquery em português, que faz
-- match por LEXEMA completo. Daí "De" não achava "Deise" — o tokenizer
-- ignora prefixos curtos e sem stemming match.
--
-- Esta versão faz busca por SUBSTRING (ILIKE) em name + email + phone,
-- com normalização de telefone (só dígitos) pra aceitar "(71) 99409"
-- e achar "5571994095636". Ranking simples: match no início do nome
-- vem primeiro, depois match em qualquer lugar, depois updated_at DESC.
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
  WITH norm AS (
    SELECT
      btrim(p_query) AS raw,
      -- Telefone: normaliza pra só dígitos. Permite digitar "(71) 99409-5636"
      -- e achar "5571994095636".
      regexp_replace(btrim(p_query), '\D', '', 'g') AS digits
  )
  SELECT c.*
  FROM active.contacts c, norm n
  WHERE c.org_id = p_org_id
    AND length(n.raw) > 0
    AND (
      c.name  ILIKE '%' || n.raw || '%'
      OR (length(n.digits) > 0 AND c.phone ILIKE '%' || n.digits || '%')
      OR c.email ILIKE '%' || n.raw || '%'
    )
  ORDER BY
    CASE
      WHEN c.name ILIKE n.raw || '%' THEN 0  -- nome começa com a query
      WHEN c.name ILIKE '%' || n.raw || '%' THEN 1  -- nome contém
      ELSE 2  -- só phone/email
    END,
    c.updated_at DESC
  LIMIT greatest(1, least(p_limit, 100));
$$;

COMMENT ON FUNCTION active.search_contacts(uuid, text, int) IS
'Busca por SUBSTRING (ILIKE) em name + phone + email. Normaliza telefone
pra só dígitos. Ranking: nome-começa-com > nome-contém > só phone/email.
Substituiu a versão tsvector da migration 002 que só fazia match por
lexema completo.';

NOTIFY pgrst, 'reload schema';
