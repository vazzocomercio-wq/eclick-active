-- Catálogo de tags por organização. Separa em dois espaços:
--   - entity_type = 'contact' → tags do CONTATO (perfil pessoal/empresa)
--   - entity_type = 'deal'    → tags do CARD/DEAL (qualificações, necessidades)
--
-- A coluna `tags` em `active.contacts` e `active.deals` (já existentes)
-- continua sendo `text[]` denormalizado pra leitura rápida. Esta tabela
-- é o catálogo MASTER que define quais tags existem, suas cores e descrições.
-- Concierge IA passa esse catálogo no prompt pra IA reusar tags existentes
-- quando possível, e cria entradas novas via /tags/upsert-many quando
-- gera tags inéditas.
--
-- Idempotente.

CREATE TABLE IF NOT EXISTS active.tag_definitions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_type   text NOT NULL CHECK (entity_type IN ('contact', 'deal')),
  -- Visual: como a tag aparece pro user (ex: "Convênio Gama")
  label         text NOT NULL CHECK (length(label) BETWEEN 1 AND 60),
  -- Slug: chave estável usada nos arrays `tags` (ex: "CONVENIO_GAMA").
  -- UPPERCASE_SNAKE_CASE, único por (org, entity_type).
  slug          text NOT NULL CHECK (length(slug) BETWEEN 1 AND 60),
  -- Cor opcional (hex #RRGGBB ou nome da paleta curada). Quando NULL,
  -- frontend usa hash automático do TagPills (paleta 8 cores).
  color         text,
  description   text,
  category      text,
  usage_count   int NOT NULL DEFAULT 0,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),

  UNIQUE (org_id, entity_type, slug)
);

CREATE INDEX IF NOT EXISTS idx_tag_definitions_org_entity
  ON active.tag_definitions (org_id, entity_type);

CREATE INDEX IF NOT EXISTS idx_tag_definitions_label_search
  ON active.tag_definitions (org_id, entity_type, lower(label));

-- Trigger pra manter updated_at fresco em cada UPDATE
DROP TRIGGER IF EXISTS trg_tag_definitions_updated_at ON active.tag_definitions;
CREATE TRIGGER trg_tag_definitions_updated_at
  BEFORE UPDATE ON active.tag_definitions
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- RLS: bloqueia acesso fora da org. Backend usa service_role e ignora
-- (já filtra org_id explicitamente), mas mantém defesa em profundidade.
ALTER TABLE active.tag_definitions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tag_definitions_select_own ON active.tag_definitions;
CREATE POLICY tag_definitions_select_own ON active.tag_definitions
  FOR SELECT USING (org_id = active.get_user_org_id());

DROP POLICY IF EXISTS tag_definitions_modify_own ON active.tag_definitions;
CREATE POLICY tag_definitions_modify_own ON active.tag_definitions
  FOR ALL USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

NOTIFY pgrst, 'reload schema';
