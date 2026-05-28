-- ═══════════════════════════════════════════════════════════════════
-- 085: e-Click Prospect — RPC helpers expostos no schema `public`
--
-- PostgREST só expõe schemas listados em db-schemas. `prospect` NÃO está
-- exposto (não queremos). Pra que o backend NestJS chame operações
-- transacionais (find_similar, merge), criamos wrappers em `public.*`
-- que delegam pro `prospect.*` com SECURITY DEFINER.
-- ═══════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────
-- 1) prospect_find_similar_entities
--    Busca entidades de uma org por similaridade cosine com um embedding.
--    Retorna: id, display_name, cnpj, similarity (0..100).
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prospect_find_similar_entities(
  p_org_id      uuid,
  p_name_vec    vector(1536),
  p_threshold   float DEFAULT 0.80,    -- 0..1 (cosine similarity, NOT distance)
  p_exclude_id  uuid DEFAULT NULL,     -- exclui essa entity da busca (a própria)
  p_limit       int DEFAULT 10
)
RETURNS TABLE (
  id           uuid,
  display_name text,
  cnpj         text,
  similarity   smallint
)
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT
    e.id,
    e.display_name,
    e.cnpj,
    -- pgvector retorna DISTANCE (0=identico). Converte pra similarity 0..100.
    GREATEST(0, LEAST(100, ((1 - (e.name_vec <=> p_name_vec)) * 100)::int))::smallint AS similarity
  FROM prospect.entities e
  WHERE e.org_id = p_org_id
    AND e.name_vec IS NOT NULL
    AND (p_exclude_id IS NULL OR e.id <> p_exclude_id)
    AND (1 - (e.name_vec <=> p_name_vec)) >= p_threshold
  ORDER BY e.name_vec <=> p_name_vec ASC      -- menor distância primeiro
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.prospect_find_similar_entities TO authenticated, service_role;

COMMENT ON FUNCTION public.prospect_find_similar_entities IS
  'Busca cosine similarity em prospect.entities da org. Retorna similarity 0..100.';

-- ───────────────────────────────────────────────────────────────────
-- 2) prospect_register_match
--    Insere match_review garantindo entity_a < entity_b (constraint do schema).
--    Idempotente: se par já existe, retorna o id existente.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prospect_register_match(
  p_entity_a    uuid,
  p_entity_b    uuid,
  p_similarity  smallint,
  p_method      text DEFAULT 'semantic',
  p_context     jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_lower uuid;
  v_upper uuid;
  v_id    uuid;
BEGIN
  -- Normaliza ordem pro constraint entity_a < entity_b
  IF p_entity_a < p_entity_b THEN
    v_lower := p_entity_a;
    v_upper := p_entity_b;
  ELSE
    v_lower := p_entity_b;
    v_upper := p_entity_a;
  END IF;

  -- Idempotente: se par já existe (em qualquer status), retorna o id
  SELECT id INTO v_id
  FROM prospect.match_review
  WHERE entity_a = v_lower AND entity_b = v_upper
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO prospect.match_review (entity_a, entity_b, similarity, match_method, context)
  VALUES (v_lower, v_upper, p_similarity, p_method, p_context)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.prospect_register_match TO authenticated, service_role;

COMMENT ON FUNCTION public.prospect_register_match IS
  'Enfileira par em match_review respeitando constraint entity_a<entity_b. Idempotente.';

-- ───────────────────────────────────────────────────────────────────
-- 3) prospect_update_name_vec
--    Atualiza name_vec de uma entity. Wrapper simples pra evitar exposição
--    de prospect.entities via PostgREST.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.prospect_update_name_vec(
  p_entity_id uuid,
  p_name_vec  vector(1536)
)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE prospect.entities
  SET name_vec = p_name_vec, updated_at = now()
  WHERE id = p_entity_id;
$$;

GRANT EXECUTE ON FUNCTION public.prospect_update_name_vec TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
