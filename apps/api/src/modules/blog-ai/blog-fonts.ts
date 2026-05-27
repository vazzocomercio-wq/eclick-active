/**
 * Catálogo de fontes de título do blog (espelho dos slugs do frontend
 * eclick-frontend/src/app/blog/_fonts/registry.ts). Mantido aqui pra validar
 * a escolha e alimentar o seletor (com nome da família p/ preview).
 * Slugs DEVEM bater com o registry do frontend.
 */
export interface BlogFontOption {
  slug: string;
  label: string;
  /** Família CSS p/ preview (Google Fonts). 'clash' usa fallback local. */
  family: string;
}

export const BLOG_FONTS: BlogFontOption[] = [
  { slug: 'clash', label: 'Clash Display', family: "'Clash Display', system-ui, sans-serif" },
  { slug: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk', sans-serif" },
  { slug: 'sora', label: 'Sora', family: "'Sora', sans-serif" },
  { slug: 'outfit', label: 'Outfit', family: "'Outfit', sans-serif" },
  { slug: 'manrope', label: 'Manrope', family: "'Manrope', sans-serif" },
  { slug: 'inter-tight', label: 'Inter Tight', family: "'Inter Tight', sans-serif" },
  { slug: 'chivo', label: 'Chivo', family: "'Chivo', sans-serif" },
  { slug: 'archivo', label: 'Archivo', family: "'Archivo', sans-serif" },
  { slug: 'syne', label: 'Syne', family: "'Syne', sans-serif" },
  { slug: 'exo2', label: 'Exo 2', family: "'Exo 2', sans-serif" },
  { slug: 'unbounded', label: 'Unbounded', family: "'Unbounded', sans-serif" },
  { slug: 'lexend', label: 'Lexend', family: "'Lexend', sans-serif" },
];

export const VALID_FONT_SLUGS = new Set(BLOG_FONTS.map((f) => f.slug));
export const DEFAULT_FONT_SLUG = 'clash';

/** Normaliza um slug recebido (fallback no default se inválido/vazio). */
export function normalizeFontSlug(slug?: string | null): string {
  return slug && VALID_FONT_SLUGS.has(slug) ? slug : DEFAULT_FONT_SLUG;
}
