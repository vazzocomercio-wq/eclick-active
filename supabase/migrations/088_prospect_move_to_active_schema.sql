-- ═══════════════════════════════════════════════════════════════════
-- 088: Move tabelas `prospect.*` pro schema `active.prospect_*`
--
-- MOTIVO: PostgREST do Supabase só expõe schemas listados em `db-schemas`.
-- O schema `prospect` não está exposto e adicionar requer Management API
-- (sem token). Como `active` já está exposto, recriamos lá com prefixo
-- `prospect_` preservando o domínio lógico.
--
-- Estratégia: DROP + CREATE (todas as 9 tabelas estavam VAZIAS — confirmado
-- via _tmp_counts; só prospect.sources tem 12 rows e fica onde está).
--
-- `prospect.sources` PERMANECE em prospect (catálogo global; só lido via
-- RPC `prospect.get_effective_weight`).
-- `prospect.is_pf_cold_enabled`, `prospect.ensure_pipeline`,
-- `public.prospect_find_similar_entities`, `prospect_register_match`,
-- `prospect_update_name_vec` — TODOS sobrevivem mas atualizados pra
-- apontar pra active.prospect_*.
-- ═══════════════════════════════════════════════════════════════════

-- 1) Drop FK cross-schema (será recriada após CREATE)
ALTER TABLE active.contacts
  DROP CONSTRAINT IF EXISTS contacts_prospect_entity_id_fkey;

-- 2) Drop tabelas em ordem inversa de dependência
DROP TABLE IF EXISTS prospect.match_review     CASCADE;
DROP TABLE IF EXISTS prospect.enrichment_jobs  CASCADE;
DROP TABLE IF EXISTS prospect.signals          CASCADE;
DROP TABLE IF EXISTS prospect.consent_ledger   CASCADE;
DROP TABLE IF EXISTS prospect.contacts         CASCADE;
DROP TABLE IF EXISTS prospect.entity_links     CASCADE;
DROP TABLE IF EXISTS prospect.entities         CASCADE;
DROP TABLE IF EXISTS prospect.raw_records      CASCADE;
DROP TABLE IF EXISTS prospect.source_overrides CASCADE;
-- prospect.sources SOBREVIVE

-- ═══════════════════════════════════════════════════════════════════
-- 3) RECRIA em active.prospect_*
-- ═══════════════════════════════════════════════════════════════════

-- ── source_overrides ─────────────────────────────────────────────────
CREATE TABLE active.prospect_source_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  source_id       text NOT NULL REFERENCES prospect.sources(id) ON DELETE CASCADE,
  weight_override smallint CHECK (weight_override BETWEEN 0 AND 100),
  active_override boolean,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_id)
);
ALTER TABLE active.prospect_source_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_source_overrides_org" ON active.prospect_source_overrides
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_prospect_source_overrides_updated_at
  BEFORE UPDATE ON active.prospect_source_overrides
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ── raw_records ──────────────────────────────────────────────────────
CREATE TABLE active.prospect_raw_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  source_id    text NOT NULL REFERENCES prospect.sources(id),
  external_ref text,
  payload      jsonb NOT NULL,
  collected_at timestamptz NOT NULL DEFAULT now(),
  cost_cents   integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_prospect_raw_records_org_source_ref
  ON active.prospect_raw_records (org_id, source_id, external_ref);
CREATE INDEX idx_prospect_raw_records_collected
  ON active.prospect_raw_records (org_id, collected_at DESC);
ALTER TABLE active.prospect_raw_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_raw_records_org" ON active.prospect_raw_records
  FOR ALL USING (org_id = active.get_user_org_id());

-- ── entities ─────────────────────────────────────────────────────────
CREATE TABLE active.prospect_entities (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_type         text NOT NULL CHECK (entity_type IN ('pj','pf')),
  cnpj                text,
  razao_social        text,
  nome_fantasia       text,
  cpf                 text,
  full_name           text,
  display_name        text,
  cnae                text,
  porte               text,
  natureza            text,
  situacao            text,
  address             jsonb,
  geo                 point,
  name_vec            vector(1536),
  confidence_score    smallint NOT NULL DEFAULT 0 CHECK (confidence_score BETWEEN 0 AND 100),
  prospect_score      smallint NOT NULL DEFAULT 0 CHECK (prospect_score BETWEEN 0 AND 100),
  status              text NOT NULL DEFAULT 'novo'
                        CHECK (status IN ('novo','enriquecido','qualificado','promovido','descartado')),
  promoted_at         timestamptz,
  promoted_contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_entity_type_doc CHECK (
    (entity_type = 'pj' AND cpf IS NULL) OR
    (entity_type = 'pf' AND cnpj IS NULL)
  )
);
CREATE UNIQUE INDEX idx_prospect_entities_org_cnpj
  ON active.prospect_entities (org_id, cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX idx_prospect_entities_org_cpf
  ON active.prospect_entities (org_id, cpf) WHERE cpf IS NOT NULL;
CREATE INDEX idx_prospect_entities_org_status
  ON active.prospect_entities (org_id, status);
CREATE INDEX idx_prospect_entities_org_score
  ON active.prospect_entities (org_id, prospect_score DESC) WHERE status != 'descartado';
CREATE INDEX idx_prospect_entities_name_vec
  ON active.prospect_entities USING ivfflat (name_vec vector_cosine_ops)
  WITH (lists = 100);
ALTER TABLE active.prospect_entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_entities_org" ON active.prospect_entities
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE TRIGGER trg_prospect_entities_updated_at
  BEFORE UPDATE ON active.prospect_entities
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ── entity_links ─────────────────────────────────────────────────────
CREATE TABLE active.prospect_entity_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  raw_record_id    uuid NOT NULL REFERENCES active.prospect_raw_records(id) ON DELETE CASCADE,
  match_method     text NOT NULL CHECK (match_method IN ('deterministic_cnpj','deterministic_cpf','probabilistic','semantic','manual')),
  match_confidence smallint NOT NULL CHECK (match_confidence BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prospect_entity_links_entity ON active.prospect_entity_links (entity_id);
CREATE INDEX idx_prospect_entity_links_raw    ON active.prospect_entity_links (raw_record_id);
ALTER TABLE active.prospect_entity_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_entity_links_org" ON active.prospect_entity_links
  FOR ALL USING (entity_id IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id()));

-- ── contacts ─────────────────────────────────────────────────────────
CREATE TABLE active.prospect_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id         uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('phone','email','instagram','facebook','tiktok','site','linkedin','whatsapp')),
  value             text NOT NULL,
  validated_in      smallint NOT NULL DEFAULT 1,
  confidence        smallint NOT NULL DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  is_pii            boolean NOT NULL DEFAULT false,
  last_validated_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, kind, value)
);
CREATE INDEX idx_prospect_contacts_entity ON active.prospect_contacts (entity_id);
CREATE INDEX idx_prospect_contacts_value  ON active.prospect_contacts (kind, value);
ALTER TABLE active.prospect_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_contacts_org" ON active.prospect_contacts
  FOR ALL USING (entity_id IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id()));

-- ── consent_ledger ───────────────────────────────────────────────────
CREATE TABLE active.prospect_consent_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  subject_kind    text NOT NULL CHECK (subject_kind IN ('pj','pf_socio','pf_lead')),
  legal_basis     text NOT NULL CHECK (legal_basis IN ('legitimo_interesse','consentimento','contrato','obrigacao_legal')),
  origin          text NOT NULL,
  origin_ip       text,
  consent_at      timestamptz,
  opt_out_at      timestamptz,
  opt_out_reason  text,
  retention_until date,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prospect_consent_entity ON active.prospect_consent_ledger (entity_id);
CREATE INDEX idx_prospect_consent_opt_out
  ON active.prospect_consent_ledger (entity_id) WHERE opt_out_at IS NOT NULL;
CREATE INDEX idx_prospect_consent_retention
  ON active.prospect_consent_ledger (retention_until) WHERE retention_until IS NOT NULL;
ALTER TABLE active.prospect_consent_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_consent_org" ON active.prospect_consent_ledger
  FOR ALL USING (entity_id IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id()));

-- ── signals ──────────────────────────────────────────────────────────
CREATE TABLE active.prospect_signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  value       jsonb,
  weight      smallint NOT NULL DEFAULT 0 CHECK (weight BETWEEN 0 AND 100),
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_prospect_signals_entity ON active.prospect_signals (entity_id);
CREATE INDEX idx_prospect_signals_type   ON active.prospect_signals (signal_type, detected_at DESC);
ALTER TABLE active.prospect_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_signals_org" ON active.prospect_signals
  FOR ALL USING (entity_id IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id()));

-- ── enrichment_jobs ──────────────────────────────────────────────────
CREATE TABLE active.prospect_enrichment_jobs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  source_id     text REFERENCES prospect.sources(id),
  target_layer  smallint NOT NULL CHECK (target_layer IN (0,1,2)),
  status        text NOT NULL DEFAULT 'queued'
                  CHECK (status IN ('queued','running','done','failed','skipped_gate')),
  cost_cents    integer NOT NULL DEFAULT 0,
  gate_reason   text,
  error_message text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  started_at    timestamptz,
  finished_at   timestamptz
);
CREATE INDEX idx_prospect_jobs_entity ON active.prospect_enrichment_jobs (entity_id);
CREATE INDEX idx_prospect_jobs_status ON active.prospect_enrichment_jobs (status, created_at)
  WHERE status IN ('queued','running');
ALTER TABLE active.prospect_enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_enrichment_jobs_org" ON active.prospect_enrichment_jobs
  FOR ALL USING (entity_id IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id()));

-- ── match_review ─────────────────────────────────────────────────────
CREATE TABLE active.prospect_match_review (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_a     uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  entity_b     uuid NOT NULL REFERENCES active.prospect_entities(id) ON DELETE CASCADE,
  similarity   smallint NOT NULL CHECK (similarity BETWEEN 0 AND 100),
  match_method text NOT NULL CHECK (match_method IN ('semantic','probabilistic','manual')),
  context      jsonb,
  status       text NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','merged','rejected')),
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (entity_a < entity_b)
);
CREATE INDEX idx_prospect_match_review_pending
  ON active.prospect_match_review (created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_prospect_match_review_entity_a ON active.prospect_match_review (entity_a);
CREATE INDEX idx_prospect_match_review_entity_b ON active.prospect_match_review (entity_b);
ALTER TABLE active.prospect_match_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_match_review_org" ON active.prospect_match_review
  FOR ALL USING (
    entity_a IN (SELECT id FROM active.prospect_entities WHERE org_id = active.get_user_org_id())
  );

-- ═══════════════════════════════════════════════════════════════════
-- 4) GRANTs nas novas tabelas
-- ═══════════════════════════════════════════════════════════════════
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_entities         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_raw_records      TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_entity_links     TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_contacts         TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_consent_ledger   TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_signals          TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_enrichment_jobs  TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_match_review     TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_source_overrides TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════════
-- 5) FK cross-schema active.contacts.prospect_entity_id agora aponta
--    pra active.prospect_entities (mesmo schema, mais limpo)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE active.contacts
  ADD CONSTRAINT contacts_prospect_entity_id_fkey
  FOREIGN KEY (prospect_entity_id)
  REFERENCES active.prospect_entities(id)
  ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════════
-- 6) RPCs em public.* atualizadas pra apontar pra active.prospect_*
-- ═══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.prospect_find_similar_entities(
  p_org_id      uuid,
  p_name_vec    vector(1536),
  p_threshold   float DEFAULT 0.80,
  p_exclude_id  uuid DEFAULT NULL,
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
    GREATEST(0, LEAST(100, ((1 - (e.name_vec <=> p_name_vec)) * 100)::int))::smallint AS similarity
  FROM active.prospect_entities e
  WHERE e.org_id = p_org_id
    AND e.name_vec IS NOT NULL
    AND (p_exclude_id IS NULL OR e.id <> p_exclude_id)
    AND (1 - (e.name_vec <=> p_name_vec)) >= p_threshold
  ORDER BY e.name_vec <=> p_name_vec ASC
  LIMIT p_limit;
$$;

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
  IF p_entity_a < p_entity_b THEN
    v_lower := p_entity_a; v_upper := p_entity_b;
  ELSE
    v_lower := p_entity_b; v_upper := p_entity_a;
  END IF;

  SELECT id INTO v_id
  FROM active.prospect_match_review
  WHERE entity_a = v_lower AND entity_b = v_upper
  LIMIT 1;

  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO active.prospect_match_review (entity_a, entity_b, similarity, match_method, context)
  VALUES (v_lower, v_upper, p_similarity, p_method, p_context)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_update_name_vec(
  p_entity_id uuid,
  p_name_vec  vector(1536)
)
RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE active.prospect_entities
  SET name_vec = p_name_vec, updated_at = now()
  WHERE id = p_entity_id;
$$;

CREATE OR REPLACE FUNCTION prospect.get_effective_weight(
  p_org_id    uuid,
  p_source_id text
) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(o.weight_override, s.base_weight)
  FROM prospect.sources s
  LEFT JOIN active.prospect_source_overrides o
    ON o.source_id = s.id AND o.org_id = p_org_id
  WHERE s.id = p_source_id
    AND COALESCE(o.active_override, s.active) = true;
$$;

NOTIFY pgrst, 'reload schema';
