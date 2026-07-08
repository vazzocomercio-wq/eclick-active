-- 109 — Endurecimento do backend do Inbox
-- Contexto: auditoria do módulo de atendimento/inbox (2026-07-08).
--   1. Índice único parcial anti-corrida de conversa duplicada (open/pending)
--   2. Índices únicos de contatos por telefone / whatsapp_jid (dedupe do worker)
--   3. RPC de mark-read atômico (evita corrida com o trigger de unread_count)
--
-- À prova de deploy: cada índice único só é criado se NÃO houver duplicatas
-- atuais (bloco DO que checa antes de criar), igual ao padrão da migração 108.
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.

-- ─── 1. Conversa ativa única por (org, contato, canal) ────────
-- Corrige a corrida do findOrCreate: dois inbounds simultâneos do mesmo
-- contato/canal criavam DUAS conversas ativas. O código passa a tratar 23505
-- deste índice como "busca a existente e devolve" (upsert-like).
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT org_id, contact_id, channel_id
    FROM active.conversations
    WHERE channel_id IS NOT NULL
      AND status IN ('open','pending')
    GROUP BY org_id, contact_id, channel_id
    HAVING count(*) > 1
  ) d;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_conversations_active_contact_channel
      ON active.conversations(org_id, contact_id, channel_id)
      WHERE channel_id IS NOT NULL AND status IN ('open','pending');
  ELSE
    RAISE NOTICE 'uq_conversations_active_contact_channel pulado: % grupo(s) duplicado(s) ativo(s). Resolva/arquive as conversas duplicadas e rode a migração de novo.', dup_count;
  END IF;
END $$;

-- ─── 2. Dedupe de contatos (telefone / whatsapp_jid) ──────────
-- O worker do WhatsApp faz findOrCreateByPhone e vai depender destes índices
-- pra upsert idempotente. Só cria se a coluna existir E não houver duplicatas.

-- 2a. (org_id, phone) WHERE phone IS NOT NULL
DO $$
DECLARE dup_count int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'active' AND table_name = 'contacts' AND column_name = 'phone'
  ) THEN
    SELECT count(*) INTO dup_count FROM (
      SELECT org_id, phone
      FROM active.contacts
      WHERE phone IS NOT NULL
      GROUP BY org_id, phone
      HAVING count(*) > 1
    ) d;

    IF dup_count = 0 THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_org_phone
        ON active.contacts(org_id, phone)
        WHERE phone IS NOT NULL;
    ELSE
      RAISE NOTICE 'uq_contacts_org_phone pulado: % grupo(s) duplicado(s) de telefone.', dup_count;
    END IF;
  ELSE
    RAISE NOTICE 'uq_contacts_org_phone pulado: coluna active.contacts.phone não existe.';
  END IF;
END $$;

-- 2b. (org_id, whatsapp_jid) WHERE whatsapp_jid IS NOT NULL
DO $$
DECLARE dup_count int;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'active' AND table_name = 'contacts' AND column_name = 'whatsapp_jid'
  ) THEN
    SELECT count(*) INTO dup_count FROM (
      SELECT org_id, whatsapp_jid
      FROM active.contacts
      WHERE whatsapp_jid IS NOT NULL
      GROUP BY org_id, whatsapp_jid
      HAVING count(*) > 1
    ) d;

    IF dup_count = 0 THEN
      CREATE UNIQUE INDEX IF NOT EXISTS uq_contacts_org_whatsapp_jid
        ON active.contacts(org_id, whatsapp_jid)
        WHERE whatsapp_jid IS NOT NULL;
    ELSE
      RAISE NOTICE 'uq_contacts_org_whatsapp_jid pulado: % grupo(s) duplicado(s) de whatsapp_jid.', dup_count;
    END IF;
  ELSE
    RAISE NOTICE 'uq_contacts_org_whatsapp_jid pulado: coluna active.contacts.whatsapp_jid não existe.';
  END IF;
END $$;

-- ─── 3. Mark-read atômico ─────────────────────────────────────
-- Problema: markAsRead fazia `SET unread_count = 0`, que corria com o trigger
-- de increment — uma msg inbound que chegasse DURANTE a leitura era zerada
-- junto (some da UI como "não lida"). Solução: sob FOR UPDATE, lê o valor
-- observado e subtrai exatamente esse tanto. Mensagens que chegam entre a
-- leitura e o update (a trigger de increment fica em fila no lock da row) são
-- preservadas. Devolve o unread_count resultante (0, ou >0 se chegou msg).
CREATE OR REPLACE FUNCTION active.conversation_mark_read(
  p_org_id uuid,
  p_conversation_id uuid
)
RETURNS int
LANGUAGE plpgsql AS $$
DECLARE
  observed int;
  new_count int;
BEGIN
  -- Trava a linha: qualquer increment concorrente (trigger de msg inbound)
  -- espera este update terminar, então soma DEPOIS — sem perder a contagem.
  SELECT unread_count INTO observed
    FROM active.conversations
    WHERE id = p_conversation_id AND org_id = p_org_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  UPDATE active.conversations
    SET unread_count = GREATEST(unread_count - observed, 0)
    WHERE id = p_conversation_id AND org_id = p_org_id
    RETURNING unread_count INTO new_count;

  RETURN new_count;
END $$;

-- Tabela/função nova exige GRANT explícito (a role postgres do _admin_exec_sql
-- não herda os default privileges do Supabase — gotcha da migração 108).
GRANT EXECUTE ON FUNCTION active.conversation_mark_read(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION active.conversation_mark_read(uuid, uuid) TO authenticated;

-- Recarrega o schema cache do PostgREST pra expor o RPC novo imediatamente.
NOTIFY pgrst, 'reload schema';
