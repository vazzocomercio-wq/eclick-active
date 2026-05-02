-- ============================================================
-- 009: custom_field_groups + custom_field_definitions + deal_number
-- ============================================================
-- Substitui qualquer versão anterior do 009. Se a versão antiga já foi
-- aplicada (tabela `custom_field_definitions` com shape sem `group_id`),
-- o DROP IF EXISTS abaixo limpa antes de recriar com o novo schema.
--
-- Conteúdo:
--   1. active.custom_field_groups (novo) — agrupamento de campos por entidade
--   2. active.custom_field_definitions (recriado) — 13 field_types + group_id
--   3. active.deals.deal_number — sequencial por org com trigger de geração
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. Limpa shape antigo (idempotente)
-- ────────────────────────────────────────────────────────────

DROP TABLE IF EXISTS active.custom_field_definitions CASCADE;

-- ────────────────────────────────────────────────────────────
-- 2. custom_field_groups
-- ────────────────────────────────────────────────────────────

CREATE TABLE active.custom_field_groups (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_type  text NOT NULL CHECK (entity_type IN ('contact', 'deal', 'company')),
  name         text NOT NULL,
  -- Nome de ícone lucide-react (ex: 'briefcase', 'map-pin'). Nullable.
  icon         text,
  position     int NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_custom_field_groups_org_entity
  ON active.custom_field_groups (org_id, entity_type, position);

ALTER TABLE active.custom_field_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_field_groups_select
  ON active.custom_field_groups
  FOR SELECT USING (org_id = active.get_user_org_id());

CREATE POLICY custom_field_groups_insert
  ON active.custom_field_groups
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY custom_field_groups_update
  ON active.custom_field_groups
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY custom_field_groups_delete
  ON active.custom_field_groups
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 3. custom_field_definitions (recriado com group_id + 13 tipos)
-- ────────────────────────────────────────────────────────────

CREATE TABLE active.custom_field_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_type   text NOT NULL CHECK (entity_type IN ('contact', 'deal', 'company')),

  -- Grupo opcional. ON DELETE SET NULL: se o grupo é apagado, o campo
  -- volta pra "Sem grupo" / "Principal".
  group_id      uuid REFERENCES active.custom_field_groups(id) ON DELETE SET NULL,

  name          text NOT NULL,

  -- 13 tipos suportados. address_short = 1 input livre; address_full = objeto
  -- estruturado (rua, num, cidade, estado, CEP, país) com auto-fill ViaCEP.
  field_type    text NOT NULL CHECK (field_type IN (
    'text', 'textarea', 'number', 'date',
    'select', 'multi_select', 'radio', 'checkbox',
    'url', 'address_short', 'address_full',
    'toggle', 'phone', 'email'
  )),

  -- Pra select/multi_select/radio: [{"label":"Mensal","value":"mensal"}, ...]
  options       jsonb NOT NULL DEFAULT '[]'::jsonb,

  is_required   boolean NOT NULL DEFAULT false,

  -- Campos só lidos via API (UI mostra disabled com badge "API")
  is_api_only   boolean NOT NULL DEFAULT false,

  position      int NOT NULL DEFAULT 0,

  -- IA pode preencher automaticamente quando detecta dado relevante na conversa
  ai_auto_fill  boolean NOT NULL DEFAULT true,

  -- Trigger automático de tarefa (pra campos type=date):
  -- {"enabled": true, "offset_days": -7, "offset_direction": "before",
  --  "task_title": "Renovar contrato", "task_type": "follow_up"}
  task_trigger  jsonb,

  -- Hint do input
  placeholder   text,

  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  -- Não permite dois campos com o mesmo nome para a mesma entidade na org
  UNIQUE (org_id, entity_type, name)
);

CREATE INDEX idx_custom_field_definitions_org_entity
  ON active.custom_field_definitions (org_id, entity_type, position);

CREATE TRIGGER trg_custom_field_definitions_updated_at
  BEFORE UPDATE ON active.custom_field_definitions
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.custom_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_field_definitions_select
  ON active.custom_field_definitions
  FOR SELECT USING (org_id = active.get_user_org_id());

CREATE POLICY custom_field_definitions_insert
  ON active.custom_field_definitions
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY custom_field_definitions_update
  ON active.custom_field_definitions
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

CREATE POLICY custom_field_definitions_delete
  ON active.custom_field_definitions
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 4. deal_number sequencial por org
-- ────────────────────────────────────────────────────────────
-- Estratégia: coluna int com trigger BEFORE INSERT que faz
--   SELECT COALESCE(MAX(deal_number), 0) + 1 FROM deals WHERE org_id = NEW.org_id
-- Não é atômico em alta concorrência (corrida de 2 inserts simultâneos no
-- mesmo org pode produzir o mesmo número), mas é simples e adequado pro
-- volume esperado de uma operação SaaS típica. Se virar gargalo, trocar
-- por advisory lock por org_id ou sequence dedicada por org.

ALTER TABLE active.deals ADD COLUMN IF NOT EXISTS deal_number int;

CREATE OR REPLACE FUNCTION active.set_deal_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = active, pg_temp
AS $$
BEGIN
  IF NEW.deal_number IS NULL THEN
    SELECT COALESCE(MAX(deal_number), 0) + 1
      INTO NEW.deal_number
      FROM active.deals
      WHERE org_id = NEW.org_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_set_deal_number ON active.deals;
CREATE TRIGGER trg_deals_set_deal_number
  BEFORE INSERT ON active.deals
  FOR EACH ROW EXECUTE FUNCTION active.set_deal_number();

-- Backfill deals existentes (uma única vez; idempotente)
UPDATE active.deals d
SET deal_number = sub.rn
FROM (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY org_id ORDER BY created_at) AS rn
  FROM active.deals
) sub
WHERE d.id = sub.id AND d.deal_number IS NULL;

-- Lock-in: agora todos os deals têm deal_number, podemos exigir NOT NULL
ALTER TABLE active.deals ALTER COLUMN deal_number SET NOT NULL;

-- Index pra busca rápida por número (ex: "abre deal #142")
CREATE INDEX IF NOT EXISTS idx_deals_deal_number
  ON active.deals (org_id, deal_number);
