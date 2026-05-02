-- ============================================================
-- 015: AI skills + agent-skill mapping + routing rules
-- ============================================================
-- Bloco F:
--  1. active.ai_skills — habilidades modulares com prompts especializados,
--     condições de ativação (intent/temperature/sentiment/custom_phrases),
--     ações permitidas e fontes de conhecimento vinculadas.
--  2. active.ai_agent_skills — many-to-many persona ↔ skill, com priority.
--  3. ai_agent_personas.routing_rules — quando ESTE agente é ativado.
--  4. knowledge_documents.priority_intents — priorizar docs por intent.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. ai_skills
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.ai_skills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL,
  skill_type      text NOT NULL DEFAULT 'custom'
                  CHECK (skill_type IN ('system', 'custom')),
  system_prompt   text NOT NULL,
  knowledge_source_ids  uuid[] NOT NULL DEFAULT '{}',
  knowledge_categories  text[] NOT NULL DEFAULT '{}',
  allowed_actions text[] NOT NULL DEFAULT '{}',
  trigger_conditions    jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority        int NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  execution_count int NOT NULL DEFAULT 0,
  avg_confidence  numeric(5,2) NOT NULL DEFAULT 0,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_ai_skills_org_active
  ON active.ai_skills (org_id, is_active);

CREATE INDEX IF NOT EXISTS idx_ai_skills_org_priority
  ON active.ai_skills (org_id, priority DESC)
  WHERE is_active = true;

CREATE TRIGGER trg_ai_skills_updated_at
  BEFORE UPDATE ON active.ai_skills
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.ai_skills ENABLE ROW LEVEL SECURITY;

CREATE POLICY ai_skills_select ON active.ai_skills
  FOR SELECT USING (org_id = active.get_user_org_id());
CREATE POLICY ai_skills_insert ON active.ai_skills
  FOR INSERT WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_skills_update ON active.ai_skills
  FOR UPDATE USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());
CREATE POLICY ai_skills_delete ON active.ai_skills
  FOR DELETE USING (org_id = active.get_user_org_id());

-- ────────────────────────────────────────────────────────────
-- 2. ai_agent_skills (M2M persona ↔ skill)
-- ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS active.ai_agent_skills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  persona_id  uuid NOT NULL REFERENCES active.ai_agent_personas(id) ON DELETE CASCADE,
  skill_id    uuid NOT NULL REFERENCES active.ai_skills(id) ON DELETE CASCADE,
  priority    int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(persona_id, skill_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_agent_skills_persona
  ON active.ai_agent_skills (persona_id, priority DESC)
  WHERE is_active = true;

ALTER TABLE active.ai_agent_skills ENABLE ROW LEVEL SECURITY;

-- RLS via persona ownership (persona já pertence à org)
CREATE POLICY ai_agent_skills_select ON active.ai_agent_skills
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM active.ai_agent_personas p
            WHERE p.id = persona_id AND p.org_id = active.get_user_org_id())
  );
CREATE POLICY ai_agent_skills_insert ON active.ai_agent_skills
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM active.ai_agent_personas p
            WHERE p.id = persona_id AND p.org_id = active.get_user_org_id())
  );
CREATE POLICY ai_agent_skills_update ON active.ai_agent_skills
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM active.ai_agent_personas p
            WHERE p.id = persona_id AND p.org_id = active.get_user_org_id())
  );
CREATE POLICY ai_agent_skills_delete ON active.ai_agent_skills
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM active.ai_agent_personas p
            WHERE p.id = persona_id AND p.org_id = active.get_user_org_id())
  );

-- ────────────────────────────────────────────────────────────
-- 3. ai_agent_personas.routing_rules
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.ai_agent_personas
  ADD COLUMN IF NOT EXISTS routing_rules jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ────────────────────────────────────────────────────────────
-- 4. knowledge_documents.priority_intents
-- ────────────────────────────────────────────────────────────

ALTER TABLE active.knowledge_documents
  ADD COLUMN IF NOT EXISTS priority_intents text[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_knowledge_priority_intents
  ON active.knowledge_documents USING GIN (priority_intents)
  WHERE is_active = true;
