-- ═══════════════════════════════════════════════════════════════════
-- 089: prospect_cnpj_index — índice leve do CNPJ Data Lake
--
-- Filosofia: dumps gigantes (5GB Receita + futuras fontes governamentais)
-- ficam no Google Drive (decisão Vazzo 2026-05-28). Aqui guardamos só
-- METADADOS LEVES por CNPJ — flags por fonte + last_seen + ponteiros pros
-- arquivos no Drive. Query rápida ("quais CNPJs vendem pra Gov Federal +
-- têm CNAE 47?") sem carregar 60M rows pesados em Postgres.
--
-- Multi-tenant: este índice é GLOBAL (catálogo de CNPJs brasileiros é
-- público). Mas o USO por org é registrado quando alguém promove um
-- CNPJ do índice pra uma entity em prospect_entities (que é multi-tenant).
-- ═══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS active.prospect_cnpj_index (
  cnpj                  text PRIMARY KEY,           -- só dígitos, 14 chars
  razao_social          text,
  nome_fantasia         text,
  cnae                  text,                       -- só atividade principal
  porte                 text,
  uf                    text,
  municipio             text,
  cep                   text,
  situacao              text,                       -- ATIVA, BAIXADA, etc

  -- Flags por fonte (true = CNPJ foi visto na fonte)
  has_receita           boolean NOT NULL DEFAULT false,
  has_gov_federal       boolean NOT NULL DEFAULT false,   -- Portal Transparência (DL.3)
  has_gov_sp            boolean NOT NULL DEFAULT false,   -- BEC SP (DL.4)
  has_gov_rj            boolean NOT NULL DEFAULT false,
  has_gov_mg            boolean NOT NULL DEFAULT false,
  has_prefeitura_top10  boolean NOT NULL DEFAULT false,   -- DL.5
  has_caixa_fornecedor  boolean NOT NULL DEFAULT false,   -- DL.6
  has_bb_fornecedor     boolean NOT NULL DEFAULT false,
  has_bndes             boolean NOT NULL DEFAULT false,

  -- Métricas agregadas (preenchidas pelos conectores)
  gov_contratos_count        integer NOT NULL DEFAULT 0,
  gov_contratos_valor_total  numeric(18, 2) NOT NULL DEFAULT 0,
  gov_last_contract_date     date,

  -- Ponteiros pros arquivos no Drive (paths relativos à pasta lake)
  --   ex: drive_files = {"receita": "receita-2026-05.parquet#row=12345",
  --                      "gov_federal": "transparencia-2026-05.parquet#row=98",
  --                      "bec_sp":      "bec-sp-2026-05.csv#row=4321"}
  drive_files           jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Timestamps
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Índices pra filtros típicos do Discovery (DL.8):
--   "vende gov federal + CNAE 47 + UF SP"
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_cnae ON active.prospect_cnpj_index (cnae);
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_uf   ON active.prospect_cnpj_index (uf);
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_situacao
  ON active.prospect_cnpj_index (situacao);

-- Índices parciais pros flags (consulta só pra "true" é mais rápido)
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_gov_federal
  ON active.prospect_cnpj_index (cnpj) WHERE has_gov_federal = true;
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_gov_sp
  ON active.prospect_cnpj_index (cnpj) WHERE has_gov_sp = true;
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_prefeitura
  ON active.prospect_cnpj_index (cnpj) WHERE has_prefeitura_top10 = true;
CREATE INDEX IF NOT EXISTS idx_prospect_cnpj_index_caixa
  ON active.prospect_cnpj_index (cnpj) WHERE has_caixa_fornecedor = true;

-- Trigger updated_at
CREATE TRIGGER trg_prospect_cnpj_index_updated_at
  BEFORE UPDATE ON active.prospect_cnpj_index
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ⚠️ Índice GLOBAL — SEM RLS. O catálogo é dado público da Receita.
-- Acesso controlado por GRANT: authenticated lê tudo (pra filtrar no Discovery
-- UI), só service_role escreve (workers/conectores).
GRANT SELECT ON active.prospect_cnpj_index TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_cnpj_index TO service_role;

COMMENT ON TABLE active.prospect_cnpj_index IS
  'Índice global leve do CNPJ Data Lake (DL.1-DL.8). Metadata + flags por fonte; arquivos pesados ficam no Drive.';

-- ═══════════════════════════════════════════════════════════════════
-- prospect_lake_runs — telemetria dos workers do lake
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS active.prospect_lake_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       text NOT NULL,                  -- 'receita_aberta', 'transparencia_federal', 'bec_sp', etc
  status          text NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued','running','done','failed')),
  rows_processed  integer NOT NULL DEFAULT 0,
  rows_inserted   integer NOT NULL DEFAULT 0,
  rows_updated    integer NOT NULL DEFAULT 0,
  bytes_uploaded  bigint NOT NULL DEFAULT 0,
  drive_file_id   text,                            -- ID do arquivo no Drive
  drive_file_path text,                            -- path relativo à pasta lake
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_prospect_lake_runs_source
  ON active.prospect_lake_runs (source_id, started_at DESC);

GRANT SELECT ON active.prospect_lake_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.prospect_lake_runs TO service_role;

COMMENT ON TABLE active.prospect_lake_runs IS
  'Telemetria das execuções dos workers do CNPJ Data Lake (cron mensal Receita + conectores governamentais).';

NOTIFY pgrst, 'reload schema';
