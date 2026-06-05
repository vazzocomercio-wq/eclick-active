-- ═══════════════════════════════════════════════════
-- 102: Radar de Conteúdo — duração-alvo das pautas de vídeo
--
-- Quando a categoria monitorada é YouTube, a pauta vira um ROTEIRO de vídeo.
-- O usuário pode pedir a DURAÇÃO desejada (3, 5, 8, 12 min…) e o roteiro é
-- dimensionado pra isso (nº de blocos, densidade de narração ~150 palavras/min).
-- Guardamos a duração-alvo (em segundos) pra alimentar o Studio / HeyGen depois.
--   target_seconds: vídeo longo = minutos*60; youtube_short ≈ 45s; demais = null
-- ═══════════════════════════════════════════════════

ALTER TABLE active.trend_briefs
  ADD COLUMN IF NOT EXISTS target_seconds int;

NOTIFY pgrst, 'reload schema';
