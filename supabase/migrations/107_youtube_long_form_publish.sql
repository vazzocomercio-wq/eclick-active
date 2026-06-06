-- ═══════════════════════════════════════════════════
-- 107: Publicação de VÍDEO LONGO no YouTube (fecha o ciclo do Radar)
--
-- Depois que o HeyGen gera o vídeo (heygen_jobs.video_url), o usuário pode
-- publicá-lo no YouTube COMO VÍDEO LONGO (não Short) — com título e descrição
-- otimizados por IA, capítulos (timestamps), tags, links e uma MINIATURA
-- composta (fundo gerado por IA + avatar por cima + título).
--
-- Reusa o OAuth/canal já existente (cortes_youtube_channels) e o upload
-- resumável do YouTubeShortsProvider (generalizado p/ vídeo longo + thumbnail).
--
-- Esta tabela guarda o RASCUNHO editável (metadados gerados pela IA) e o
-- resultado da publicação. Idempotente por (org_id, heygen_job_id): um vídeo
-- HeyGen vira no máximo 1 publicação (não republica sem querer).
-- ═══════════════════════════════════════════════════

CREATE TABLE active.social_youtube_publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES active.organizations(id) ON DELETE CASCADE,

  -- Origem: vídeo do HeyGen (quando veio do Radar) e a URL do mp4 a subir.
  heygen_job_id uuid REFERENCES active.heygen_jobs(id) ON DELETE SET NULL,
  source_video_url text NOT NULL,

  -- Canal escolhido (cortes_youtube_channels.id). Null = canal padrão do Drive.
  channel_cred_id uuid REFERENCES active.cortes_youtube_channels(id) ON DELETE SET NULL,

  -- Metadados otimizados (editáveis antes de publicar).
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  tags text[] NOT NULL DEFAULT '{}',
  category_id text NOT NULL DEFAULT '27',     -- 27 = Educação
  privacy text NOT NULL DEFAULT 'public' CHECK (privacy IN ('public', 'unlisted', 'private')),
  chapters jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{"t":"0:00","label":"Introdução"}, ...]

  -- Miniatura composta (signed URL + caminho no Storage p/ reupload).
  thumbnail_url text,
  thumbnail_storage_path text,

  -- Estado da publicação.
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'publishing', 'published', 'failed')),
  youtube_video_id text,
  youtube_url text,
  published_at timestamptz,
  error text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_syp_org ON active.social_youtube_publications (org_id, created_at DESC);

-- Idempotência: 1 publicação por vídeo HeyGen (quando há origem HeyGen).
CREATE UNIQUE INDEX uq_syp_heygen
  ON active.social_youtube_publications (org_id, heygen_job_id)
  WHERE heygen_job_id IS NOT NULL;

CREATE TRIGGER trg_syp_updated_at
  BEFORE UPDATE ON active.social_youtube_publications
  FOR EACH ROW EXECUTE FUNCTION active.set_updated_at();

ALTER TABLE active.social_youtube_publications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "syp_org" ON active.social_youtube_publications
  FOR ALL USING (org_id = active.get_user_org_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON active.social_youtube_publications
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
