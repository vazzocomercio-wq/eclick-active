-- ═══════════════════════════════════════════════════════════════════
-- 084: e-Click Prospect — Lead Intelligence Engine (Fase 0 — fundação)
--
-- Schema separado `prospect.*` (isolamento de raw/PII vs `active.*`).
-- Promove entidades pro Active via bridge cross-schema (ref por entity_id,
-- não duplica dado).
--
-- Princípios:
--  • Compliance by design — consent_ledger obrigatório antes de promover.
--  • Cascata de enriquecimento com gates de custo (Corte_1 ≥50, Corte_2 ≥70).
--  • Entity resolution: determinístico (CNPJ) + pgvector (cosine > 0.90)
--    + fila match_review (0.80–0.90 → revisão humana).
--  • Multi-tenant: tabela-filha escopa via FK entity_id → entity.org_id
--    (evita bug de RLS blanket — ver feedback_multitenant_leak_patterns).
--
-- Arquitetura de enrichment (decisão 2026-05-28):
--  • Active descobre (Receita Aberta + Places + sellers ML/Shopee).
--  • CNPJ camada 0 direto no Active (BrasilAPI/Receita Aberta).
--  • Camadas 1/2 pagas → bridge `/internal/enrichment/lookup` no SaaS
--    (reusa enrichment_routing + cache do `eclick-backend`).
--
-- Banidos do seed: Serasa, Assertiva (decisão de produto 2026-05-28).
-- ═══════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS prospect;
GRANT USAGE ON SCHEMA prospect TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 1) sources — catálogo global de fontes (pesos default)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.sources (
  id            text PRIMARY KEY,                    -- 'receita_aberta', 'google_places', 'directdata'...
  display_name  text NOT NULL,
  layer         smallint NOT NULL CHECK (layer IN (0, 1, 2)),  -- 0=grátis, 1=paga média, 2=paga premium
  base_weight   smallint NOT NULL CHECK (base_weight BETWEEN 0 AND 100),
  is_pii_source boolean NOT NULL DEFAULT false,      -- traz dado pessoal (PF)?
  via_bridge    boolean NOT NULL DEFAULT false,      -- chamado via `/internal/enrichment/lookup` SaaS?
  cost_cents_estimate integer NOT NULL DEFAULT 0,    -- custo médio por chamada
  active        boolean NOT NULL DEFAULT true,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON prospect.sources TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.sources TO service_role;

COMMENT ON TABLE prospect.sources IS
  'Catálogo global de fontes do Prospect. Pesos default; cada org pode sobrescrever via prospect.source_overrides.';

-- Seed inicial — só fontes aprovadas (Serasa e Assertiva banidas)
INSERT INTO prospect.sources (id, display_name, layer, base_weight, is_pii_source, via_bridge, cost_cents_estimate, notes) VALUES
  -- CAMADA 0 — grátis / quase grátis, Active chama direto
  ('receita_aberta',    'Receita Federal — Dados Abertos',    0, 100, false, false, 0,  'Dump bulk grátis (60M CNPJs). BrasilAPI pra frescor pontual.'),
  ('brasilapi_cnpj',    'BrasilAPI CNPJ',                     0, 100, false, false, 0,  'Wrapper grátis sobre dados Receita Aberta.'),
  ('google_places',     'Google Places',                      0,  80, false, false, 3,  'Camada 0 — ⚠️ ToS restringe cache. Só place_id + campos derivados.'),
  ('ml_seller',         'Mercado Livre — Seller Discovery',   0,  92, false, false, 0,  'Seller verificado com volume = ICP forte (peso 92 vs 50 site sem verif).'),
  ('shopee_seller',     'Shopee — Seller Discovery',          0,  92, false, false, 0,  'Mesmo critério ML — seller verificado.'),
  ('viacep',            'ViaCEP',                             0,  80, false, true,  0,  'CEP grátis. Bridge porque já está no SaaS enrichment_routing.'),

  -- CAMADA 1 — paga média, via bridge SaaS (reusa enrichment_routing + cache)
  ('hubdev',            'Hub do Desenvolvedor',               1,  75, false, true,  15, 'CPF/CNPJ/CEP/email. Mais barato (~R$0.15) — bom pra alto volume.'),
  ('directdata',        'DirectData',                         1,  78, true,  true,  40, 'CPF/CNPJ/telefone. is_pii=true (sócios PF). Token per-org ou env.'),
  ('bigdatacorp',       'BigDataCorp',                        1,  78, true,  true,  60, 'Premium PJ+PF. Telefone, e-mail, sócios, presença digital.'),

  -- CAMADA 2 — paga premium, via bridge SaaS
  ('datastone',         'DataStone',                          2,  80, true,  true,  50, 'Telefone/WhatsApp validados. PF — só uso com consent.'),
  ('ph3a',              'PH3A DataBusca',                     2,  82, true,  true,  70, 'CPF/CNPJ + score de crédito + telefones rankeados.'),
  ('linkedin_provider', 'LinkedIn (provider licenciado)',     2,  75, true,  true, 100, 'Decisores B2B. Pendente: definir provider (Proxycurl/Coresignal). NUNCA raspar.');

-- ───────────────────────────────────────────────────────────────────
-- 2) source_overrides — pesos editáveis por org (decisão 2026-05-28)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.source_overrides (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  source_id       text NOT NULL REFERENCES prospect.sources(id) ON DELETE CASCADE,
  weight_override smallint CHECK (weight_override BETWEEN 0 AND 100),  -- NULL = usa base_weight
  active_override boolean,                                              -- NULL = usa sources.active
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, source_id)
);

ALTER TABLE prospect.source_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_source_overrides_org" ON prospect.source_overrides
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_prospect_source_overrides_updated_at
  BEFORE UPDATE ON prospect.source_overrides
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.source_overrides TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 3) raw_records — provenance (nada se perde)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.raw_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  source_id    text NOT NULL REFERENCES prospect.sources(id),
  external_ref text,                                  -- cnpj, place_id, @handle, url
  payload      jsonb NOT NULL,                        -- resposta crua da fonte
  collected_at timestamptz NOT NULL DEFAULT now(),
  cost_cents   integer NOT NULL DEFAULT 0             -- custo real desta chamada (CAC tracking)
);

CREATE INDEX idx_prospect_raw_records_org_source_ref
  ON prospect.raw_records (org_id, source_id, external_ref);
CREATE INDEX idx_prospect_raw_records_collected
  ON prospect.raw_records (org_id, collected_at DESC);

ALTER TABLE prospect.raw_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_raw_records_org" ON prospect.raw_records
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.raw_records TO authenticated, service_role;

COMMENT ON TABLE prospect.raw_records IS
  'Payload bruto de cada chamada de fonte. Provenance auditável (LGPD).';

-- ───────────────────────────────────────────────────────────────────
-- 4) entities — perfil-mestre
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.entities (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  entity_type      text NOT NULL CHECK (entity_type IN ('pj', 'pf')),

  -- PJ
  cnpj             text,                              -- só preenchido se entity_type='pj'
  razao_social     text,
  nome_fantasia    text,

  -- PF (só com opt-in/inbound — coleta fria proibida)
  cpf              text,                              -- só preenchido se entity_type='pf'
  full_name        text,

  -- compartilhados
  display_name     text,
  cnae             text,
  porte            text,
  natureza         text,
  situacao         text,                              -- situação cadastral Receita
  address          jsonb,                             -- {logradouro, numero, bairro, cidade, uf, cep}
  geo              point,                             -- (lng, lat)

  name_vec         vector(1536),                     -- embedding p/ entity resolution semântica

  confidence_score smallint NOT NULL DEFAULT 0
    CHECK (confidence_score BETWEEN 0 AND 100),       -- qualidade do dado
  prospect_score   smallint NOT NULL DEFAULT 0
    CHECK (prospect_score BETWEEN 0 AND 100),         -- chance de comprar

  status           text NOT NULL DEFAULT 'novo'
    CHECK (status IN ('novo','enriquecido','qualificado','promovido','descartado')),

  promoted_at      timestamptz,                       -- quando virou contact no Active
  promoted_contact_id uuid REFERENCES active.contacts(id) ON DELETE SET NULL,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- CNPJ é único POR ORG (orgs diferentes podem ter mesma empresa em pipelines distintos)
CREATE UNIQUE INDEX idx_prospect_entities_org_cnpj
  ON prospect.entities (org_id, cnpj) WHERE cnpj IS NOT NULL;
CREATE UNIQUE INDEX idx_prospect_entities_org_cpf
  ON prospect.entities (org_id, cpf) WHERE cpf IS NOT NULL;

CREATE INDEX idx_prospect_entities_org_status
  ON prospect.entities (org_id, status);
CREATE INDEX idx_prospect_entities_org_score
  ON prospect.entities (org_id, prospect_score DESC) WHERE status != 'descartado';

-- pgvector index pra similaridade de nome (cosine)
CREATE INDEX idx_prospect_entities_name_vec
  ON prospect.entities USING ivfflat (name_vec vector_cosine_ops)
  WITH (lists = 100);

-- Consistência: PJ tem CNPJ ou CPF não pode coexistir
ALTER TABLE prospect.entities ADD CONSTRAINT chk_entity_type_doc CHECK (
  (entity_type = 'pj' AND cpf IS NULL) OR
  (entity_type = 'pf' AND cnpj IS NULL)
);

ALTER TABLE prospect.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_entities_org" ON prospect.entities
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE TRIGGER trg_prospect_entities_updated_at
  BEFORE UPDATE ON prospect.entities
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.entities TO authenticated, service_role;

COMMENT ON TABLE prospect.entities IS
  'Perfil-mestre PJ ou PF. Status: novo→enriquecido→qualificado→promovido (vira active.contacts via ref).';

-- ───────────────────────────────────────────────────────────────────
-- 5) entity_links — vínculo raw → entidade (resultado do Entity Resolver)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.entity_links (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id        uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  raw_record_id   uuid NOT NULL REFERENCES prospect.raw_records(id) ON DELETE CASCADE,
  match_method     text NOT NULL CHECK (match_method IN ('deterministic_cnpj','deterministic_cpf','probabilistic','semantic','manual')),
  match_confidence smallint NOT NULL CHECK (match_confidence BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_entity_links_entity ON prospect.entity_links (entity_id);
CREATE INDEX idx_prospect_entity_links_raw    ON prospect.entity_links (raw_record_id);

ALTER TABLE prospect.entity_links ENABLE ROW LEVEL SECURITY;
-- escopa via entity → org_id (evita bug de policy blanket)
CREATE POLICY "prospect_entity_links_org" ON prospect.entity_links
  FOR ALL USING (entity_id IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.entity_links TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 6) contacts — pontos de contato (telefone/email/social)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id     uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('phone','email','instagram','facebook','tiktok','site','linkedin','whatsapp')),
  value         text NOT NULL,                       -- E.164 pra phone, lowercase pra email
  validated_in  smallint NOT NULL DEFAULT 1,         -- nº de fontes que confirmaram (bônus corroboração)
  confidence    smallint NOT NULL DEFAULT 0
    CHECK (confidence BETWEEN 0 AND 100),
  is_pii        boolean NOT NULL DEFAULT false,      -- ⚠️ se for de sócio PF, marca true
  last_validated_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_id, kind, value)
);

CREATE INDEX idx_prospect_contacts_entity ON prospect.contacts (entity_id);
CREATE INDEX idx_prospect_contacts_value  ON prospect.contacts (kind, value);

ALTER TABLE prospect.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_contacts_org" ON prospect.contacts
  FOR ALL USING (entity_id IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.contacts TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 7) consent_ledger — base legal por entidade E por sujeito (LGPD)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.consent_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id       uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  subject_kind    text NOT NULL CHECK (subject_kind IN ('pj','pf_socio','pf_lead')),
  legal_basis     text NOT NULL CHECK (legal_basis IN ('legitimo_interesse','consentimento','contrato','obrigacao_legal')),
  origin          text NOT NULL,                     -- 'receita_aberta','tiktok_live','form_site',...
  origin_ip       text,                              -- IP do solicitante (se opt-in via form)
  consent_at      timestamptz,
  opt_out_at      timestamptz,                       -- preenchido pelo endpoint público de opt-out
  opt_out_reason  text,
  retention_until date,                              -- expurgo automático após esta data
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_consent_entity ON prospect.consent_ledger (entity_id);
CREATE INDEX idx_prospect_consent_opt_out
  ON prospect.consent_ledger (entity_id) WHERE opt_out_at IS NOT NULL;
CREATE INDEX idx_prospect_consent_retention
  ON prospect.consent_ledger (retention_until) WHERE retention_until IS NOT NULL;

ALTER TABLE prospect.consent_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_consent_org" ON prospect.consent_ledger
  FOR ALL USING (entity_id IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.consent_ledger TO authenticated, service_role;

COMMENT ON TABLE prospect.consent_ledger IS
  'LGPD: base legal por entidade e por sujeito. Opt-out propaga p/ Active (gate de promoção).';

-- ───────────────────────────────────────────────────────────────────
-- 8) signals — sinais de intenção
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.signals (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id   uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  signal_type text NOT NULL,                          -- 'marketplace_seller','no_own_ecommerce','high_reviews','posting_active','ads_running'...
  value       jsonb,                                  -- {"platform":"mercadolivre","visits_7d":16000,...}
  weight      smallint NOT NULL DEFAULT 0
    CHECK (weight BETWEEN 0 AND 100),
  detected_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prospect_signals_entity ON prospect.signals (entity_id);
CREATE INDEX idx_prospect_signals_type   ON prospect.signals (signal_type, detected_at DESC);

ALTER TABLE prospect.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_signals_org" ON prospect.signals
  FOR ALL USING (entity_id IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.signals TO authenticated, service_role;

-- ───────────────────────────────────────────────────────────────────
-- 9) enrichment_jobs — fila com gates de custo (CAC tracking)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.enrichment_jobs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  source_id    text REFERENCES prospect.sources(id),  -- qual fonte específica (NULL = qualquer da camada)
  target_layer smallint NOT NULL CHECK (target_layer IN (0, 1, 2)),
  status       text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','running','done','failed','skipped_gate')),
  cost_cents   integer NOT NULL DEFAULT 0,            -- custo real desta chamada
  gate_reason  text,                                  -- 'score_below_corte_1','opt_out','already_enriched',...
  error_message text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  started_at   timestamptz,
  finished_at  timestamptz
);

CREATE INDEX idx_prospect_jobs_entity ON prospect.enrichment_jobs (entity_id);
CREATE INDEX idx_prospect_jobs_status ON prospect.enrichment_jobs (status, created_at)
  WHERE status IN ('queued','running');

ALTER TABLE prospect.enrichment_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_enrichment_jobs_org" ON prospect.enrichment_jobs
  FOR ALL USING (entity_id IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id()));

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.enrichment_jobs TO authenticated, service_role;

COMMENT ON TABLE prospect.enrichment_jobs IS
  'Fila com gates de custo. status=skipped_gate quando bloqueado por score/opt-out (cost_cents=0).';

-- ───────────────────────────────────────────────────────────────────
-- 10) match_review — revisão humana de matches médios (0.80–0.90)
-- ───────────────────────────────────────────────────────────────────
CREATE TABLE prospect.match_review (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_a     uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  entity_b     uuid NOT NULL REFERENCES prospect.entities(id) ON DELETE CASCADE,
  similarity   smallint NOT NULL CHECK (similarity BETWEEN 0 AND 100),
  match_method text NOT NULL CHECK (match_method IN ('semantic','probabilistic','manual')),
  context      jsonb,                                  -- {fields_compared:[...], evidence:[...]}
  status       text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','merged','rejected')),
  reviewed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at  timestamptz,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (entity_a < entity_b)                         -- evita duplicar par (A,B) e (B,A)
);

CREATE INDEX idx_prospect_match_review_pending
  ON prospect.match_review (created_at DESC) WHERE status = 'pending';
CREATE INDEX idx_prospect_match_review_entity_a ON prospect.match_review (entity_a);
CREATE INDEX idx_prospect_match_review_entity_b ON prospect.match_review (entity_b);

ALTER TABLE prospect.match_review ENABLE ROW LEVEL SECURITY;
CREATE POLICY "prospect_match_review_org" ON prospect.match_review
  FOR ALL USING (
    entity_a IN (SELECT id FROM prospect.entities WHERE org_id = active.get_user_org_id())
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON prospect.match_review TO authenticated, service_role;

COMMENT ON TABLE prospect.match_review IS
  'Fila de revisão humana p/ matches 0.80-0.90 (NUNCA merge cego nessa faixa).';

-- ═══════════════════════════════════════════════════════════════════
-- Helper RPC: get_effective_weight — pega weight com override por org
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION prospect.get_effective_weight(
  p_org_id    uuid,
  p_source_id text
) RETURNS smallint
LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(o.weight_override, s.base_weight)
  FROM prospect.sources s
  LEFT JOIN prospect.source_overrides o
    ON o.source_id = s.id AND o.org_id = p_org_id
  WHERE s.id = p_source_id
    AND COALESCE(o.active_override, s.active) = true;
$$;

GRANT EXECUTE ON FUNCTION prospect.get_effective_weight(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION prospect.get_effective_weight IS
  'Retorna peso efetivo da fonte considerando override por org. NULL se fonte desativada.';
