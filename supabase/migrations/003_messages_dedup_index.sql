-- ============================================================
-- e-Click Active — Migration 003: Messages dedup index
-- Schema: active
-- Date: 2026-05-01
-- Description: UNIQUE INDEX por partição em (org_id, channel_message_id)
--              pra prevenir mensagens duplicadas quando Z-API/WhatsApp
--              entregam o mesmo webhook mais de uma vez.
-- ============================================================

-- ── Por que por-partição e não no parent? ──
--
-- PostgreSQL exige que UNIQUE em tabela particionada inclua a coluna de
-- partição (created_at). Incluir created_at no UNIQUE não dedupa de fato
-- (dois rows com mesmo channel_message_id em timestamps diferentes
-- passariam). Solução: aplicar o UNIQUE em cada partição separadamente.
--
-- Z-API messageIds são únicos globalmente; replays do mesmo webhook
-- acontecem em segundos/minutos — sempre dentro da mesma partição
-- mensal. A dedup é eficaz na prática.

DO $$
DECLARE
  partition_name text;
  index_name     text;
BEGIN
  FOR partition_name IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    JOIN pg_class p ON p.oid = i.inhparent
    JOIN pg_namespace n ON n.oid = p.relnamespace
    WHERE p.relname = 'messages'
      AND n.nspname = 'active'
  LOOP
    index_name := 'idx_' || partition_name || '_dedup';
    EXECUTE format(
      'CREATE UNIQUE INDEX IF NOT EXISTS %I ON active.%I (org_id, channel_message_id) WHERE channel_message_id IS NOT NULL',
      index_name,
      partition_name
    );
  END LOOP;
END $$;

COMMENT ON SCHEMA active IS 'e-Click Active CRM - Inteligência Comercial Ativa (migrations 001-003 aplicadas)';

-- ── Partições futuras ──
--
-- Quando criar novas partições mensais (worker / job manual), aplicar
-- o índice junto. Função auxiliar pra encapsular o padrão:

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

  -- Cria a partição
  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS active.%I PARTITION OF active.messages
       FOR VALUES FROM (%L) TO (%L)',
    v_partition_name,
    v_start_date,
    v_end_date
  );

  -- Aplica o índice de dedup
  EXECUTE format(
    'CREATE UNIQUE INDEX IF NOT EXISTS %I ON active.%I (org_id, channel_message_id) WHERE channel_message_id IS NOT NULL',
    v_index_name,
    v_partition_name
  );

  RETURN v_partition_name;
END;
$$;

COMMENT ON FUNCTION active.create_messages_partition(int, int) IS
'Cria uma partição mensal de active.messages e aplica o índice de dedup
em uma única operação. Use no worker que rotaciona partições.
Exemplo: SELECT active.create_messages_partition(2027, 5);';
