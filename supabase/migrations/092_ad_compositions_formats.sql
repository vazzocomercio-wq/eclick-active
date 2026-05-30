-- ============================================================
-- 092: ad_compositions — formatos (Onda 2) + reuso de conteúdo
-- ============================================================
-- Estende a composição pra suportar carrossel, vídeo/reels e
-- "promover post existente" reaproveitando o motor de conteúdo do
-- Social AI Studio (active.social_contents).
--
--   creative_format : image | carousel | video | reels
--   creative_source : ai (gera copy) | manual | content (reusa social_content)
--   content_id      : ref. solta ao social_content reusado (sem FK dura)
--   object_story_id : post do FB JÁ publicado (page_post_id "PAGEID_POSTID")
--                     — quando setado, o anúncio promove o post existente
--                     (mantém engajamento), sem montar creative do zero.
--   cards           : carrossel [{image_url,image_hash,headline,description,link}]
--   video           : {url,video_id,thumbnail_url,duration_sec,width,height}
-- ============================================================

ALTER TABLE active.ad_compositions
  ADD COLUMN IF NOT EXISTS creative_format text NOT NULL DEFAULT 'image'
    CHECK (creative_format IN ('image', 'carousel', 'video', 'reels')),
  ADD COLUMN IF NOT EXISTS creative_source text NOT NULL DEFAULT 'ai'
    CHECK (creative_source IN ('ai', 'manual', 'content')),
  ADD COLUMN IF NOT EXISTS content_id uuid,
  ADD COLUMN IF NOT EXISTS object_story_id text,
  ADD COLUMN IF NOT EXISTS cards jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS video jsonb;

CREATE INDEX IF NOT EXISTS idx_ad_compositions_content
  ON active.ad_compositions (content_id)
  WHERE content_id IS NOT NULL;

COMMENT ON COLUMN active.ad_compositions.object_story_id IS
  'page_post_id do FB (PAGEID_POSTID) p/ promover post já publicado como anúncio pago (reuso do conteúdo do Studio).';
