-- ═══════════════════════════════════════════════════
-- 082: Blog IA — fonte de display escolhível
--  (a) blog_settings.display_font  → fonte PADRÃO do blog (todo o site)
--  (b) blog_posts.display_font     → override por artigo (opcional)
-- O slug é resolvido no frontend (catálogo next/font). A escolha padrão é
-- espelhada no Sanity (siteSettings.blogDisplayFont) pra o site público aplicar.
-- ═══════════════════════════════════════════════════

ALTER TABLE active.blog_settings ADD COLUMN IF NOT EXISTS display_font text;
ALTER TABLE active.blog_posts    ADD COLUMN IF NOT EXISTS display_font text;

COMMENT ON COLUMN active.blog_settings.display_font IS
  'Slug da fonte de título padrão do blog (ex: clash, sora, space-grotesk). Espelhado no Sanity siteSettings.';
COMMENT ON COLUMN active.blog_posts.display_font IS
  'Override opcional da fonte de título deste post (slug). Escrito no doc Sanity como displayFont.';
