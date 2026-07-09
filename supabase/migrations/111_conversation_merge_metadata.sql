-- 111 — Merge atômico de metadata de conversa
-- Contexto: a Fase B (product-interest) grava conversations.metadata.product_interest.
-- O padrão antigo (read-modify-write do jsonb inteiro) corre com o writer do
-- concierge (concierge_state) — dois gravadores concorrentes na mesma conversa
-- causam lost-update (um sobrescreve a chave do outro). Esta função faz merge
-- shallow ATÔMICO (um único UPDATE, sem leitura antes): `metadata || patch`
-- substitui só as chaves de topo do patch, preservando concierge_state, etc.
--
-- Idempotente. Sem mudança de dado existente.

CREATE OR REPLACE FUNCTION active.conversation_merge_metadata(
  p_org_id uuid,
  p_conversation_id uuid,
  p_patch jsonb
)
RETURNS void
LANGUAGE sql AS $$
  UPDATE active.conversations
    SET metadata = coalesce(metadata, '{}'::jsonb) || p_patch
    WHERE id = p_conversation_id AND org_id = p_org_id;
$$;

-- Função nova exige GRANT explícito (role postgres do _admin_exec_sql não herda
-- os default privileges do Supabase — gotcha das migrações 108/109).
GRANT EXECUTE ON FUNCTION active.conversation_merge_metadata(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION active.conversation_merge_metadata(uuid, uuid, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
