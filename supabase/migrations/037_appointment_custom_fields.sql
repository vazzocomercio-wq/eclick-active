-- 037: custom fields configuráveis por appointment_type
--
-- Cada tipo de agendamento pode definir campos extras a coletar antes do
-- atendimento. Genérico por nicho:
--   • clínica:   peso, altura, queixa, convênio
--   • salão:     comprimento desejado, alergia a químicos, foto referência
--   • oficina:   marca/modelo/ano do veículo, sintoma, KM rodados
--   • consultoria: faturamento atual, segmento, principais dores
--
-- Schema (text[] ou jsonb): lista de objetos com shape:
--   {
--     "key": "patient_weight",        -- chave estável (snake_case)
--     "label": "Peso (kg)",           -- label amigável pra UI
--     "type": "number",               -- text|textarea|number|select|date|boolean
--     "required": true,
--     "options": ["A","B","C"],       -- só pra type=select
--     "placeholder": "...",
--     "help_text": "...",
--     "min": 0, "max": 300            -- só pra type=number
--   }
--
-- Os valores coletados ficam em appointment.metadata.custom_fields = {key: value}.
-- Validação backend em AppointmentsService.create.

ALTER TABLE active.appointment_types
  ADD COLUMN IF NOT EXISTS custom_fields_schema jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Sanity check: schema deve ser array
ALTER TABLE active.appointment_types
  DROP CONSTRAINT IF EXISTS appointment_types_custom_fields_schema_is_array;
ALTER TABLE active.appointment_types
  ADD CONSTRAINT appointment_types_custom_fields_schema_is_array
  CHECK (jsonb_typeof(custom_fields_schema) = 'array');

COMMENT ON COLUMN active.appointment_types.custom_fields_schema IS
  'Array de definições de campos customizados a coletar pra esse tipo. Veja migration 037.';
