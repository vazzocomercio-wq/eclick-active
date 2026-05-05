-- ============================================================
-- 048: alert_managers — gestores que recebem alertas via WhatsApp
-- ============================================================
-- Bloco H do Active Intelligence: cada org cadastra 1+ managers (gerente
-- de marketing, dono, sócio) que recebem alertas dos signals em
-- ad_signals. Cada manager tem phone próprio, verificado via código
-- enviado por WhatsApp.
--
-- channel_id: opcional. Quando NULL, AlertEngine usa o canal WhatsApp
-- default da org (primeiro ativo). Permite uma org multi-canal escolher
-- mandar alertas internos via canal específico (ex: número corporativo
-- separado do número de atendimento ao cliente).
--
-- preferences:
--   { quiet_hours: {start: "22:00", end: "08:00"}, locale: "pt-BR" }
--   Não obriga schema rígido — JSONB livre, futuras prefs adicionadas
--   sem migration.
--
-- status:
--   pending_verification — cadastrado mas não enviou código ainda
--   active               — verificado, recebendo alertas
--   suspended            — usuário pausou
-- ============================================================

CREATE TABLE IF NOT EXISTS active.alert_managers (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  /** Nome humano (aparece no log + saudação na msg). */
  name                     text NOT NULL,
  /** Telefone E.164 ou só dígitos (ex: 5571999999999). resolveJid normaliza. */
  phone                    text NOT NULL,
  /** Departamento/cargo livre — ex: "Marketing", "Comercial", "Diretoria" */
  department               text,
  /** Canal WhatsApp pra mandar (opcional — default = canal default da org) */
  channel_id               uuid REFERENCES active.channels(id) ON DELETE SET NULL,
  preferences              jsonb NOT NULL DEFAULT '{}'::jsonb,
  /** Código de 6 dígitos enviado por WhatsApp pra verificação. */
  verification_code        text,
  verification_expires_at  timestamptz,
  verified_at              timestamptz,
  status                   text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'active', 'suspended')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

-- Mesmo phone só pode ser cadastrado 1x por org
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_managers_org_phone
  ON active.alert_managers (org_id, phone);

CREATE INDEX IF NOT EXISTS idx_alert_managers_org_status
  ON active.alert_managers (org_id, status);

ALTER TABLE active.alert_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_isolation" ON active.alert_managers;
CREATE POLICY "org_isolation" ON active.alert_managers
  FOR ALL USING (org_id = active.get_user_org_id());

CREATE OR REPLACE FUNCTION active.tg_alert_managers_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_alert_managers_updated_at ON active.alert_managers;
CREATE TRIGGER tg_alert_managers_updated_at
  BEFORE UPDATE ON active.alert_managers
  FOR EACH ROW EXECUTE FUNCTION active.tg_alert_managers_updated_at();

COMMENT ON TABLE active.alert_managers IS
  'Gestores que recebem alertas. Phone verificado via código WhatsApp.';
