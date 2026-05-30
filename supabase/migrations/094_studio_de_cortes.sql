-- ═══════════════════════════════════════════════════
-- 094: Studio de Cortes — pipeline de vídeo longo → cortes verticais
-- Upload/YouTube/Drive → corte (API externa, ex: Vizard) → copys (IA) →
-- fila de revisão (kanban) → [publicação = Sprint 2].
--
-- Extensão do Social AI Studio (054). Mesmo padrão: schema active,
-- RLS por org_id, trigger updated_at, grants authenticated+service_role.
-- ═══════════════════════════════════════════════════

-- ─── 1. content_jobs ─────────────────────────────
-- Um "job" = um vídeo-master enviado para ser cortado.
CREATE TABLE active.content_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  title text,

  -- Fonte do master
  source_type text NOT NULL DEFAULT 'upload'
    CHECK (source_type IN ('upload', 'youtube', 'drive')),
  drive_file_id text,          -- master no Shared Drive (/cortes/{job_id}/master.mp4)
  drive_folder_id text,        -- pasta do job no Shared Drive
  youtube_video_id text,       -- se source_type='youtube'
  resolution text,             -- resolução detectada do master (ex: "1920x1080")

  -- Pipeline
  status text NOT NULL DEFAULT 'received' CHECK (status IN (
    'received',         -- criado, master no Drive
    'fetching',         -- baixando/preparando fonte (youtube/drive)
    'clipping',         -- submetido à API externa, aguardando webhook
    'generating_copy',  -- cortes prontos, gerando copys com IA
    'in_review',        -- na fila de revisão (kanban)
    'publishing',       -- Sprint 2
    'done',
    'failed'
  )),
  failure_reason text,

  -- Provedor de corte
  clipping_provider text,      -- ex: 'vizard'
  clipping_job_id text,        -- id do job no provedor (idempotência do webhook)

  transcript text,             -- transcrição do master inteiro (quando o provedor devolve)

  -- Toggle por job: auto-aprovar cortes ao chegarem na revisão (default OFF)
  auto_approve boolean NOT NULL DEFAULT false,

  -- Janitor: marca quando o master foi apagado do Drive
  master_deleted_at timestamptz,

  created_by uuid REFERENCES active.org_members(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_jobs_org ON active.content_jobs(org_id);
CREATE INDEX idx_content_jobs_status ON active.content_jobs(org_id, status);
-- Lookup do webhook: (provider, clipping_job_id) → job
CREATE INDEX idx_content_jobs_clipping ON active.content_jobs(clipping_provider, clipping_job_id)
  WHERE clipping_job_id IS NOT NULL;
-- Janitor: jobs concluídos com master ainda no Drive
CREATE INDEX idx_content_jobs_master_alive ON active.content_jobs(org_id, status)
  WHERE master_deleted_at IS NULL;

CREATE TRIGGER trg_content_jobs_updated_at
  BEFORE UPDATE ON active.content_jobs
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 2. clips ────────────────────────────────────
-- Um corte vertical (9:16) gerado a partir de um content_job.
CREATE TABLE active.clips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES active.content_jobs(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  provider_clip_id text,       -- id do corte no provedor (idempotência)
  title text,                  -- tópico/título sugerido pelo provedor
  file_url text,               -- URL do arquivo do corte (provedor ou Drive)
  drive_file_id text,          -- arquivo de trabalho no Shared Drive

  duration_seconds numeric,
  start_seconds numeric,       -- timestamp no master onde o corte começa
  end_seconds numeric,
  width integer,               -- esperado 1080
  height integer,              -- esperado 1920
  thumbnail_url text,

  transcript text,             -- transcrição do corte
  hook text,                   -- gancho de abertura

  status text NOT NULL DEFAULT 'a_revisar' CHECK (status IN (
    'a_revisar', 'aprovado', 'agendado', 'publicado', 'falhou'
  )),

  -- Janitor: arquivo de trabalho apagado do Drive (M dias após publicado)
  work_file_deleted_at timestamptz,

  order_index integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_clips_org ON active.clips(org_id, status);
CREATE INDEX idx_clips_job ON active.clips(job_id);
-- Idempotência do webhook: não recriar corte já existente
CREATE UNIQUE INDEX idx_clips_provider_unique ON active.clips(job_id, provider_clip_id)
  WHERE provider_clip_id IS NOT NULL;
-- Janitor: cortes publicados com arquivo de trabalho ainda vivo
CREATE INDEX idx_clips_workfile_alive ON active.clips(org_id, status)
  WHERE work_file_deleted_at IS NULL;

CREATE TRIGGER trg_clips_updated_at
  BEFORE UPDATE ON active.clips
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 3. clip_posts ───────────────────────────────
-- Copy + agendamento de um corte para UMA plataforma. Publicação = Sprint 2.
CREATE TABLE active.clip_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clip_id uuid NOT NULL REFERENCES active.clips(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok', 'youtube')),
  account_id text,             -- conta/canal de destino (resolvido no Sprint 2)

  title text,                  -- título (YouTube Shorts)
  copy text,                   -- legenda/descrição da plataforma
  hashtags text[] NOT NULL DEFAULT '{}',

  scheduled_at timestamptz,
  external_post_id text,       -- id do post publicado (Sprint 2)

  status text NOT NULL DEFAULT 'rascunho' CHECK (status IN (
    'rascunho', 'agendado', 'publicado', 'falhou'
  )),
  metrics jsonb NOT NULL DEFAULT '{}',

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(clip_id, platform)
);

CREATE INDEX idx_clip_posts_org ON active.clip_posts(org_id, status);
CREATE INDEX idx_clip_posts_clip ON active.clip_posts(clip_id);

CREATE TRIGGER trg_clip_posts_updated_at
  BEFORE UPDATE ON active.clip_posts
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

-- ─── 4. RLS ──────────────────────────────────────
ALTER TABLE active.content_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.clips ENABLE ROW LEVEL SECURITY;
ALTER TABLE active.clip_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "content_jobs_org" ON active.content_jobs
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "clips_org" ON active.clips
  FOR ALL USING (org_id = active.get_user_org_id());
CREATE POLICY "clip_posts_org" ON active.clip_posts
  FOR ALL USING (org_id = active.get_user_org_id());

-- ─── 5. Realtime (board atualiza ao vivo, igual social_contents) ──
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.content_jobs;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.clips;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE active.clip_posts;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE active.content_jobs REPLICA IDENTITY DEFAULT;
ALTER TABLE active.clips REPLICA IDENTITY DEFAULT;
ALTER TABLE active.clip_posts REPLICA IDENTITY DEFAULT;

-- ─── 6. Grants ───────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON active.content_jobs TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.clips TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON active.clip_posts TO authenticated, service_role;
