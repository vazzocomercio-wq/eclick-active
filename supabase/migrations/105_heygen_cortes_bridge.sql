-- ═══════════════════════════════════════════════════
-- 105: Ponte HeyGen → Studio de Cortes
--
-- Depois que o HeyGen gera o vídeo (heygen_jobs.video_url), o usuário pode
-- mandar o Studio de Cortes recortá-lo em vídeos verticais (Vizard aceita a URL
-- remota direto — sem passar pelo Drive). Dois caminhos:
--   1) MANUAL: botão "Gerar cortes" no card do vídeo HeyGen concluído.
--   2) AUTOMÁTICO: heygen_jobs.auto_cortes = true → ao concluir, um worker
--      dispara o corte. GATED pela env CORTES_AUTO_FROM_HEYGEN (default OFF)
--      até validarmos — pra não consumir crédito/$ sem aprovação.
--
-- Esta migration:
--   • content_jobs aceita source_type='heygen' + guarda a URL remota da fonte
--     (source_url) e o vínculo de volta (heygen_job_id).
--   • heygen_jobs ganha o toggle auto_cortes + o vínculo cortes_job_id.
-- ═══════════════════════════════════════════════════

-- ─── content_jobs: nova fonte "heygen" + URL remota direta ───
ALTER TABLE active.content_jobs
  DROP CONSTRAINT IF EXISTS content_jobs_source_type_check;
ALTER TABLE active.content_jobs
  ADD CONSTRAINT content_jobs_source_type_check
  CHECK (source_type IN ('upload', 'youtube', 'drive', 'heygen'));

ALTER TABLE active.content_jobs
  ADD COLUMN IF NOT EXISTS source_url text;          -- master remoto direto (ex: mp4 do HeyGen)
ALTER TABLE active.content_jobs
  ADD COLUMN IF NOT EXISTS heygen_job_id uuid
    REFERENCES active.heygen_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_content_jobs_heygen
  ON active.content_jobs (heygen_job_id)
  WHERE heygen_job_id IS NOT NULL;

-- ─── heygen_jobs: toggle de automação + vínculo do corte gerado ───
ALTER TABLE active.heygen_jobs
  ADD COLUMN IF NOT EXISTS auto_cortes boolean NOT NULL DEFAULT false;
ALTER TABLE active.heygen_jobs
  ADD COLUMN IF NOT EXISTS cortes_job_id uuid
    REFERENCES active.content_jobs(id) ON DELETE SET NULL;

-- worker da ponte: jobs concluídos, com automação ligada e ainda sem corte
CREATE INDEX IF NOT EXISTS idx_heygen_jobs_auto_pending
  ON active.heygen_jobs (status)
  WHERE auto_cortes = true AND cortes_job_id IS NULL;

NOTIFY pgrst, 'reload schema';
