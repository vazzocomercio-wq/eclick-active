-- ═══════════════════════════════════════════════════
-- 067 — Onda 3 / S5: Calendário de Conteúdo
-- Tabela onde o usuário planeja/agenda publicações.
-- FKs lógicas (UUID sem REFERENCES) pra entidades do SaaS:
-- product_id, social_content_id, ads_campaign_id.
-- ═══════════════════════════════════════════════════

CREATE TABLE active.content_calendar (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,

  -- Conteúdo
  title           text NOT NULL,
  content_type    text NOT NULL CHECK (content_type IN (
    'social_post','story','reel','tiktok','email','whatsapp_broadcast','ad_launch'
  )),
  channel         text NOT NULL CHECK (channel IN (
    'instagram','facebook','tiktok','whatsapp','email','meta_ads','google_ads'
  )),

  -- FKs lógicas (SaaS) — sem REFERENCES porque cross-schema/cross-project
  product_id          uuid,
  social_content_id   uuid,
  ads_campaign_id     uuid,

  -- Agendamento
  scheduled_date  date NOT NULL,
  scheduled_time  time,
  timezone        text NOT NULL DEFAULT 'America/Bahia',

  -- Status
  status text NOT NULL DEFAULT 'planned' CHECK (status IN (
    'idea','planned','content_ready','approved','scheduled','published','cancelled'
  )),
  notes  text,
  color  text DEFAULT '#00E5FF',

  -- Snapshot opcional do recurso vinculado pra não depender 100% do SaaS estar online
  -- Ex: { product: { name, thumbnail_url }, social: { caption_preview }, ... }
  resource_snapshot jsonb NOT NULL DEFAULT '{}',

  -- Timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_cal_org      ON active.content_calendar(org_id);
CREATE INDEX idx_content_cal_date     ON active.content_calendar(org_id, scheduled_date);
CREATE INDEX idx_content_cal_channel  ON active.content_calendar(org_id, channel);
CREATE INDEX idx_content_cal_status   ON active.content_calendar(org_id, status);
CREATE INDEX idx_content_cal_product  ON active.content_calendar(product_id)
  WHERE product_id IS NOT NULL;

CREATE TRIGGER trg_content_cal_updated
  BEFORE UPDATE ON active.content_calendar
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── RLS ─────────────────────────────────────────
-- Padrão Active: usa active.get_user_org_id() (resolve via auth.uid → org_members)
-- ao invés de JOIN manual com organization_members.

ALTER TABLE active.content_calendar ENABLE ROW LEVEL SECURITY;

CREATE POLICY content_cal_select ON active.content_calendar
  FOR SELECT TO authenticated
  USING (org_id = active.get_user_org_id());

CREATE POLICY content_cal_modify ON active.content_calendar
  FOR ALL TO authenticated
  USING (org_id = active.get_user_org_id())
  WITH CHECK (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.content_calendar
  TO authenticated, service_role;

-- Realtime opcional (drag-and-drop multi-user vê updates instantâneos)
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.content_calendar;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

COMMENT ON TABLE active.content_calendar IS
  'Calendário de planejamento/agendamento de conteúdo. Active só planeja — quem publica é o SaaS quando scheduled_at chega.';
COMMENT ON COLUMN active.content_calendar.product_id IS
  'FK lógica pra public.products no SaaS — sem REFERENCES (cross-schema).';
COMMENT ON COLUMN active.content_calendar.social_content_id IS
  'FK lógica pra public.social_content (S1 do SaaS).';
COMMENT ON COLUMN active.content_calendar.ads_campaign_id IS
  'FK lógica pra public.ads_campaigns (S4 do SaaS).';
