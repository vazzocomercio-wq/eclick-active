-- 108 — Endurecimento do SAC + infra de lock distribuído
-- Contexto: auditoria do módulo de atendimento (2026-07-08).
--   1. ticket_number sequencial com advisory lock (evita colisão sob concorrência)
--   2. prazo de 1ª resposta persistido + breach checker estendido
--   3. índice único parcial pra dedupe de ticket preventivo (condicional)
--   4. tabela app_locks + RPCs de lease-lock (usada por schedulers/worker/concierge)
-- Idempotente: pode rodar mais de uma vez sem efeito colateral.

-- ─── 1. ticket_number sob advisory lock por org ───────────────
-- Antes: SELECT MAX(ticket_number)+1 sem lock → dois inserts simultâneos
-- calculavam o mesmo número e o segundo estourava a UNIQUE (org_id, ticket_number).
CREATE OR REPLACE FUNCTION active.sac_set_ticket_number()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ticket_number IS NULL OR NEW.ticket_number = 0 THEN
    -- Lock por org (hash do uuid) serializa a numeração sem travar outras orgs.
    PERFORM pg_advisory_xact_lock(hashtext('sac_ticket_number:' || NEW.org_id::text));
    SELECT COALESCE(MAX(ticket_number), 0) + 1
      INTO NEW.ticket_number
      FROM active.sac_tickets
      WHERE org_id = NEW.org_id;
  END IF;
  RETURN NEW;
END $$;

-- ─── 2. Prazo de 1ª resposta + breach checker estendido ───────
ALTER TABLE active.sac_tickets
  ADD COLUMN IF NOT EXISTS sla_first_response_deadline_at timestamptz;

CREATE OR REPLACE FUNCTION active.sac_check_sla_breaches()
RETURNS TABLE (ticket_id uuid, org_id uuid)
LANGUAGE sql AS $$
  WITH breached AS (
    UPDATE active.sac_tickets
    SET sla_breached = true
    WHERE sla_breached = false
      AND status NOT IN ('resolved','cancelled')
      AND (
        (sla_deadline_at IS NOT NULL AND sla_deadline_at < now())
        OR (
          sla_first_response_deadline_at IS NOT NULL
          AND first_response_at IS NULL
          AND sla_first_response_deadline_at < now()
        )
      )
    RETURNING id, org_id
  )
  SELECT id AS ticket_id, org_id FROM breached;
$$;
GRANT EXECUTE ON FUNCTION active.sac_check_sla_breaches TO service_role;

-- ─── 3. Dedupe de ticket preventivo (índice único condicional) ─
-- Só cria o índice se não houver duplicatas atuais — evita falhar o deploy.
DO $$
DECLARE dup_count int;
BEGIN
  SELECT count(*) INTO dup_count FROM (
    SELECT org_id, order_marketplace_id
    FROM active.sac_tickets
    WHERE is_preventive
      AND order_marketplace_id IS NOT NULL
      AND status NOT IN ('resolved','cancelled')
    GROUP BY org_id, order_marketplace_id
    HAVING count(*) > 1
  ) d;

  IF dup_count = 0 THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_sac_preventive_open_order
      ON active.sac_tickets(org_id, order_marketplace_id)
      WHERE is_preventive
        AND order_marketplace_id IS NOT NULL
        AND status NOT IN ('resolved','cancelled');
  ELSE
    RAISE NOTICE 'uq_sac_preventive_open_order pulado: % grupo(s) duplicado(s)', dup_count;
  END IF;
END $$;

-- ─── 4. Infra de lock distribuído (lease-based) ───────────────
-- Funciona sobre conexões pooled (pgBouncer) — é operação de linha, não
-- advisory lock de sessão. Usado por schedulers, worker Baileys e concierge
-- pra impedir execução dupla quando há 2+ instâncias.
CREATE TABLE IF NOT EXISTS active.app_locks (
  name         text PRIMARY KEY,
  holder       text NOT NULL,
  acquired_at  timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL
);
-- Gotcha conhecida: tabela criada via _admin_exec_sql (role postgres) não herda
-- os default privileges do Supabase. GRANT explícito é obrigatório.
GRANT ALL ON TABLE active.app_locks TO service_role;

-- Adquire/renova um lock. Retorna true se conseguiu (livre, expirado, ou mesmo holder).
CREATE OR REPLACE FUNCTION active.try_acquire_lock(
  p_name text,
  p_holder text,
  p_ttl_seconds int
)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE affected int;
BEGIN
  INSERT INTO active.app_locks (name, holder, acquired_at, expires_at)
  VALUES (p_name, p_holder, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (name) DO UPDATE
    SET holder = EXCLUDED.holder,
        acquired_at = now(),
        expires_at = EXCLUDED.expires_at
    WHERE active.app_locks.expires_at < now()
       OR active.app_locks.holder = EXCLUDED.holder;
  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected > 0;
END $$;

CREATE OR REPLACE FUNCTION active.release_lock(p_name text, p_holder text)
RETURNS void LANGUAGE sql AS $$
  DELETE FROM active.app_locks WHERE name = p_name AND holder = p_holder;
$$;

GRANT EXECUTE ON FUNCTION active.try_acquire_lock TO service_role;
GRANT EXECUTE ON FUNCTION active.release_lock TO service_role;

-- Recarrega o schema cache do PostgREST pra expor os RPCs novos imediatamente.
NOTIFY pgrst, 'reload schema';
