-- Bloco AI Concierge — primeira camada de inteligência conversacional
--
-- Adiciona descrições editáveis em pipelines e stages pra que a IA possa
-- rotear leads inteligentemente baseado em entender o que cada pipeline
-- representa (não só o nome). Sem coluna dedicada a IA escolhe pelo nome,
-- com a coluna dá pra dizer "Pipeline pra B2B enterprise, ticket > 50k".
--
-- O setting `organizations.settings.ai_concierge` é configurado
-- diretamente no JSONB existente (não precisa migration), com shape:
--   {
--     enabled: boolean,
--     auto_reply: boolean,
--     send_bridge_message: boolean,
--     business_context: string  // texto livre descrevendo o negócio
--   }

ALTER TABLE active.pipelines
  ADD COLUMN IF NOT EXISTS description text;

ALTER TABLE active.pipeline_stages
  ADD COLUMN IF NOT EXISTS description text;

COMMENT ON COLUMN active.pipelines.description IS
  'Descrição livre do pipeline. Usada pela IA do AI Concierge pra rotear leads. Ex: "Pipeline pra clientes B2B enterprise, ticket > 50k, com ciclo longo"';

COMMENT ON COLUMN active.pipeline_stages.description IS
  'Descrição livre do stage. Usada pela IA pra escolher onde encaixar o lead. Ex: "Cliente já demonstrou interesse e tem orçamento aprovado"';

-- Notify PostgREST pra recarregar o schema cache (Supabase usa esse signal)
NOTIFY pgrst, 'reload schema';
