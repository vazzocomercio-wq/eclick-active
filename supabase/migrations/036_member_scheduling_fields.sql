-- Adiciona campos de agendamento por profissional em org_members.
--
-- Modelo simplificado pedido pelo user (2026-05-05):
-- "no painel do profissional colocamos quanto tempo ele faz por atendimento
--  e o sistema já calcula a disponibilidade para deixar livre na agenda"
--
-- - `specialties`: array de especialidades/serviços que o profissional
--   atende. Texto livre por org pra cobrir qualquer nicho — clínica
--   ('nutricionista', 'oncologista'), salão ('corte', 'manicure'),
--   oficina ('motor', 'elétrica'), B2B ('vendas', 'pré-venda'), etc.
--   IA do Concierge usa pra match contra mensagem do cliente.
-- - `default_duration_minutes`: duração padrão de atendimento. Sistema
--   calcula slots livres dividindo a janela de availability por essa
--   duração + buffer. Quando NULL, usa `appointment_type.duration_minutes`
--   (modelo legado/avançado pra orgs que tenham vários tipos por
--   profissional). Default 30 cobre maioria.
-- - `default_buffer_minutes`: tempo entre atendimentos (intervalo de
--   reposição/limpeza). Default 0 — opcional.
--
-- Idempotente.

ALTER TABLE active.org_members
  ADD COLUMN IF NOT EXISTS specialties text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS default_duration_minutes integer
    CHECK (default_duration_minutes IS NULL OR default_duration_minutes > 0),
  ADD COLUMN IF NOT EXISTS default_buffer_minutes integer NOT NULL DEFAULT 0
    CHECK (default_buffer_minutes >= 0);

-- Index pra match rápido por especialidade (IA Concierge consulta
-- ORG x SPECIALTY pra encontrar agente disponível).
CREATE INDEX IF NOT EXISTS idx_org_members_specialties
  ON active.org_members USING gin (specialties);

NOTIFY pgrst, 'reload schema';
