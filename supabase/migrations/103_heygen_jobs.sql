-- ═══════════════════════════════════════════════════
-- 103: HeyGen — jobs de vídeo com avatar a partir do roteiro da pauta
--
-- O Radar gera o roteiro (trend_briefs.script). Daí o usuário pode mandar o
-- HeyGen transformar o roteiro num VÍDEO com avatar/voz. Cada disparo vira um
-- job: guardamos o video_id do HeyGen + status e, no fim, a URL do vídeo.
-- O HeyGen é chamado DIRETO (X-Api-Key) pela active-api — env HEYGEN_API_KEY.
--   status: pending | processing | completed | failed
-- ═══════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS active.heygen_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES active.trend_briefs(id) ON DELETE SET NULL,

  avatar_id text NOT NULL,
  voice_id text NOT NULL,
  title text,
  script text NOT NULL,                              -- narração limpa enviada ao HeyGen
  dimension jsonb NOT NULL DEFAULT '{"width":1280,"height":720}',

  heygen_video_id text,                              -- id do POST /v2/video/generate
  status text NOT NULL DEFAULT 'pending',            -- pending|processing|completed|failed
  video_url text,
  thumbnail_url text,
  duration_sec numeric,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_heygen_jobs_org
  ON active.heygen_jobs (org_id, created_at DESC);
-- só os jobs em andamento interessam ao worker de polling
CREATE INDEX IF NOT EXISTS idx_heygen_jobs_open
  ON active.heygen_jobs (status)
  WHERE status IN ('pending', 'processing');

ALTER TABLE active.heygen_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heygen_jobs_org" ON active.heygen_jobs
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.heygen_jobs TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
