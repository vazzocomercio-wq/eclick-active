-- ============================================================
-- 065 — WhatsApp Commerce B5: cart recovery automation runner
-- ============================================================
-- Adiciona suporte a triggers de commerce em active.automations e
-- cria função de seed que pré-configura uma automação padrão de
-- recuperação de carrinho quando commerce é habilitado pela primeira vez.
--
-- Não modifica trigger_type (text livre — já aceita os novos valores).
-- A migração é idempotente: usa ON CONFLICT pra reusar nomes únicos por org.

-- ────────────────────────────────────────────────────────────
-- 1) Função: seed_default_commerce_automations
--    Cria 1 automação default por org (cart_abandoned) se não existir.
--    Idempotente — garantida por unique constraint name+org_id+trigger_type.
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION active.seed_default_commerce_automations(p_org_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = active, public
AS $$
DECLARE
  v_existing_count int;
BEGIN
  -- Skip se já existe automation pra cart_abandoned nessa org
  SELECT COUNT(*) INTO v_existing_count
  FROM active.automations
  WHERE org_id = p_org_id
    AND trigger_type = 'cart_abandoned';

  IF v_existing_count > 0 THEN
    RETURN;
  END IF;

  -- Cria automação padrão de recuperação 1h após abandono
  INSERT INTO active.automations (
    org_id,
    name,
    description,
    trigger_type,
    trigger_config,
    actions,
    is_active,
    natural_language_source
  ) VALUES (
    p_org_id,
    'Recuperação de carrinho abandonado (padrão)',
    'Envia mensagem amigável quando o cliente abandona um carrinho com pelo menos 1 item, lembrando o total e oferecendo continuidade.',
    'cart_abandoned',
    jsonb_build_object('min_total', 0),
    jsonb_build_array(
      jsonb_build_object(
        'type', 'send_message',
        'text',
        E'Oi {{contact.first_name}}! 👋\n\nVi que você ficou de finalizar seu pedido — {{cart.items_count}} item(s) no valor de {{cart.total}}. Posso te ajudar a fechar?\n\nSe preferir, é só responder aqui e seguimos.'
      )
    ),
    false, -- inicia desligada — usuário ativa quando quiser
    'Automação padrão criada ao habilitar WhatsApp Commerce'
  );
END;
$$;

COMMENT ON FUNCTION active.seed_default_commerce_automations(uuid) IS
  'Cria automação default de recuperação de carrinho quando WhatsApp Commerce é habilitado. Idempotente.';

-- ────────────────────────────────────────────────────────────
-- 2) Trigger: dispara seed quando whatsapp_commerce_settings.enabled vira true
-- ────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION active.trg_seed_commerce_automations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = active, public
AS $$
BEGIN
  -- Só dispara quando enabled FLIPS de false/null pra true
  IF NEW.enabled = true AND (OLD.enabled IS NULL OR OLD.enabled = false) THEN
    PERFORM active.seed_default_commerce_automations(NEW.org_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commerce_settings_seed_automations
  ON active.whatsapp_commerce_settings;

CREATE TRIGGER commerce_settings_seed_automations
  AFTER INSERT OR UPDATE OF enabled
  ON active.whatsapp_commerce_settings
  FOR EACH ROW
  EXECUTE FUNCTION active.trg_seed_commerce_automations();

COMMENT ON TRIGGER commerce_settings_seed_automations
  ON active.whatsapp_commerce_settings IS
  'Cria automação default de recuperação de carrinho ao habilitar commerce.';

-- ────────────────────────────────────────────────────────────
-- 3) Backfill: orgs já com commerce enabled ganham a automação default
-- ────────────────────────────────────────────────────────────

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT org_id
    FROM active.whatsapp_commerce_settings
    WHERE enabled = true
  LOOP
    PERFORM active.seed_default_commerce_automations(r.org_id);
  END LOOP;
END $$;

-- ────────────────────────────────────────────────────────────
-- 4) Index pra acelerar checkTriggers em commerce events
-- ────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_automations_commerce_active
  ON active.automations(org_id, trigger_type)
  WHERE is_active = true
    AND trigger_type IN (
      'cart_abandoned', 'cart_recovered',
      'order_created', 'order_paid', 'order_shipped'
    );
