-- ============================================================
-- 012: REPLICA IDENTITY pra messages + funções de criação de partição
-- ============================================================
-- active.messages NÃO tem PRIMARY KEY (apenas ai_interactions tem).
-- Sem PK, REPLICA IDENTITY DEFAULT é silenciosamente equivalente a NOTHING,
-- e UPDATEs em partições que estão na publication do Realtime falham com:
--   "cannot update table because it does not have a replica identity"
--
-- Solução: REPLICA IDENTITY FULL em todas as partições de messages
-- (o WAL grava todas as colunas pra identificar a row no replicate stream).
-- Custo: rows um pouco maiores no WAL — aceitável no nosso volume.
--
-- Pra ai_interactions, DEFAULT (com PK) funciona — só garantimos explicitamente
-- que está setado e propagamos pra novas partições.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Aplica REPLICA IDENTITY FULL em todas as partições atuais de messages
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'active'
      AND (c.relname = 'messages' OR c.relname LIKE 'messages\_%' ESCAPE '\')
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I REPLICA IDENTITY FULL', rec.nspname, rec.relname);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. Garante REPLICA IDENTITY DEFAULT em ai_interactions (já tem PK)
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE rec record;
BEGIN
  FOR rec IN
    SELECT n.nspname, c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'active'
      AND (c.relname = 'ai_interactions' OR c.relname LIKE 'ai\_interactions\_%' ESCAPE '\')
      AND c.relkind IN ('r', 'p')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I REPLICA IDENTITY DEFAULT', rec.nspname, rec.relname);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 3. create_messages_partition — agora com REPLICA IDENTITY FULL
-- ────────────────────────────────────────────────────────────
-- Substitui a versão da migration 003. Toda partição nova já nasce
-- com replica identity correta + índice de dedup (que vinha de 003).

CREATE OR REPLACE FUNCTION active.create_messages_partition(
  p_year  int,
  p_month int
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_partition_name text;
  v_index_name     text;
  v_start_date     date;
  v_end_date       date;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date   := v_start_date + interval '1 month';
  v_partition_name := 'messages_' || to_char(v_start_date, 'YYYY_MM');
  v_index_name     := 'idx_' || v_partition_name || '_dedup';

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS active.%I PARTITION OF active.messages
       FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start_date, v_end_date
  );

  -- Índice de dedup (mantido da 003)
  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON active.%I (org_id, channel_message_id) WHERE channel_message_id IS NOT NULL',
    v_index_name, v_partition_name
  );

  -- NOVO: replica identity pro UPDATE funcionar com publication do Realtime
  EXECUTE format(
    'ALTER TABLE active.%I REPLICA IDENTITY FULL',
    v_partition_name
  );

  RETURN v_partition_name;
END;
$$;

COMMENT ON FUNCTION active.create_messages_partition(int, int) IS
'Cria uma partição mensal de active.messages, aplica o índice de dedup
e seta REPLICA IDENTITY FULL (necessário pra UPDATEs com Realtime publication).
Use no worker que rotaciona partições.
Exemplo: SELECT active.create_messages_partition(2027, 5);';

-- ────────────────────────────────────────────────────────────
-- 4. create_ai_interactions_partition — função paralela
-- ────────────────────────────────────────────────────────────
-- Equivalente pra ai_interactions. Não havia função; criação de
-- partições futuras estava manual. Encapsula com REPLICA IDENTITY DEFAULT
-- (ai_interactions tem PK (id, created_at) — DEFAULT funciona).

CREATE OR REPLACE FUNCTION active.create_ai_interactions_partition(
  p_year  int,
  p_month int
)
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  v_partition_name text;
  v_start_date     date;
  v_end_date       date;
BEGIN
  v_start_date := make_date(p_year, p_month, 1);
  v_end_date   := v_start_date + interval '1 month';
  v_partition_name := 'ai_interactions_' || to_char(v_start_date, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS active.%I PARTITION OF active.ai_interactions
       FOR VALUES FROM (%L) TO (%L)',
    v_partition_name, v_start_date, v_end_date
  );

  EXECUTE format(
    'ALTER TABLE active.%I REPLICA IDENTITY DEFAULT',
    v_partition_name
  );

  RETURN v_partition_name;
END;
$$;

COMMENT ON FUNCTION active.create_ai_interactions_partition(int, int) IS
'Cria uma partição mensal de active.ai_interactions e seta REPLICA IDENTITY DEFAULT.
Exemplo: SELECT active.create_ai_interactions_partition(2027, 5);';

-- ────────────────────────────────────────────────────────────
-- 5. Cleanup pontual: 4 mensagens stuck em pending da conversa da Deise
-- ────────────────────────────────────────────────────────────
-- Foram enviadas pelo Baileys (chegaram no destinatário) mas o markSent
-- falhou porque a partição não tinha replica identity. Agora que está
-- resolvido (passo 1), atualizamos manualmente pra refletir realidade.
-- Não é destrutivo — só marca como "sent" o que já foi entregue.

UPDATE active.messages
SET status = 'sent'
WHERE id IN (
  '1cdb4999-5532-460a-a27b-da98477b4ddf',  -- "oi"     17:11
  'b6bc9846-17ae-4fee-a76d-93f713588122',  -- "certo"  17:06
  '0c7e0d89-ef21-4ebb-a70c-df7906c52dc5',  -- "certo"  16:58
  '8888a772-4586-4f44-9136-bdc73d4a8a19'   -- "certo"  16:50
)
AND status = 'pending';
