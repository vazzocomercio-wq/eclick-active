-- ═══════════════════════════════════════════════════════════════════
-- 086: link active.contacts ↔ prospect.entities (cross-schema)
--
-- Permite que um contato no Active referencie a entidade do Prospect
-- que o originou, SEM duplicar dado (decisão da spec: bridge cross-schema
-- por referência).
-- ═══════════════════════════════════════════════════════════════════

ALTER TABLE active.contacts
  ADD COLUMN IF NOT EXISTS prospect_entity_id uuid
    REFERENCES prospect.entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_prospect_entity
  ON active.contacts(prospect_entity_id)
  WHERE prospect_entity_id IS NOT NULL;

COMMENT ON COLUMN active.contacts.prospect_entity_id IS
  'Se o contato foi promovido pelo módulo Prospect, aponta pra entity-mãe.';

-- ═══════════════════════════════════════════════════════════════════
-- RPC: ensure default prospect pipeline + stage
-- Cria (se não existir) um pipeline "Prospect" na org com 4 estágios.
-- Idempotente. Retorna { pipeline_id, first_stage_id }.
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.prospect_ensure_pipeline(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pipeline_id uuid;
  v_first_stage uuid;
BEGIN
  -- 1) Pipeline com nome 'Prospect' já existe?
  SELECT id INTO v_pipeline_id
  FROM active.pipelines
  WHERE org_id = p_org_id AND lower(name) = 'prospect'
  LIMIT 1;

  IF v_pipeline_id IS NULL THEN
    -- Cria pipeline novo (NÃO marca como is_default — preserva o atual)
    INSERT INTO active.pipelines (org_id, name, settings)
    VALUES (p_org_id, 'Prospect', jsonb_build_object('source', 'prospect_module'))
    RETURNING id INTO v_pipeline_id;

    -- Estágios canônicos
    INSERT INTO active.pipeline_stages (pipeline_id, name, position, color, probability) VALUES
      (v_pipeline_id, 'Novo lead',       0, '#00E5FF', 5),
      (v_pipeline_id, 'Em qualificação', 1, '#7C3AED', 25),
      (v_pipeline_id, 'Abordagem feita', 2, '#F59E0B', 50),
      (v_pipeline_id, 'Convertido',      3, '#10B981', 100);

    -- Marca o último como is_won
    UPDATE active.pipeline_stages
    SET is_won = true
    WHERE pipeline_id = v_pipeline_id AND name = 'Convertido';
  END IF;

  SELECT id INTO v_first_stage
  FROM active.pipeline_stages
  WHERE pipeline_id = v_pipeline_id
  ORDER BY position ASC
  LIMIT 1;

  RETURN jsonb_build_object(
    'pipeline_id', v_pipeline_id,
    'first_stage_id', v_first_stage
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.prospect_ensure_pipeline(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.prospect_ensure_pipeline IS
  'Garante existência do pipeline "Prospect" + estágios canônicos. Idempotente.';

NOTIFY pgrst, 'reload schema';
