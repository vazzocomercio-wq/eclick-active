/**
 * Catálogo de fontes de título do blog (espelho de
 * eclick-frontend/src/app/blog/_fonts/registry.ts). Usado pra validar a escolha
 * e alimentar o seletor (label + group p/ agrupar no dropdown, family/google
 * p/ o preview ao vivo). ⚠️ Slugs DEVEM bater com o registry do frontend.
 */
export interface BlogFontOption {
  slug: string;
  label: string;
  /** família CSS p/ preview. */
  family: string;
  /** parâmetro `family` do Google Fonts CSS2 (null = local/Clash). */
  google: string | null;
  group: string;
}

export const BLOG_FONTS: BlogFontOption[] = [
  // Moderno
  { slug: 'clash', label: 'Clash Display', family: "'Clash Display', system-ui, sans-serif", google: null, group: 'Moderno' },
  { slug: 'space-grotesk', label: 'Space Grotesk', family: "'Space Grotesk', sans-serif", google: 'Space+Grotesk:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'sora', label: 'Sora', family: "'Sora', sans-serif", google: 'Sora:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'manrope', label: 'Manrope', family: "'Manrope', sans-serif", google: 'Manrope:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'outfit', label: 'Outfit', family: "'Outfit', sans-serif", google: 'Outfit:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'dm-sans', label: 'DM Sans', family: "'DM Sans', sans-serif", google: 'DM+Sans:wght@400;500;700', group: 'Moderno' },
  { slug: 'inter-tight', label: 'Inter Tight', family: "'Inter Tight', sans-serif", google: 'Inter+Tight:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'work-sans', label: 'Work Sans', family: "'Work Sans', sans-serif", google: 'Work+Sans:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'lexend', label: 'Lexend', family: "'Lexend', sans-serif", google: 'Lexend:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'chivo', label: 'Chivo', family: "'Chivo', sans-serif", google: 'Chivo:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'archivo', label: 'Archivo', family: "'Archivo', sans-serif", google: 'Archivo:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'mulish', label: 'Mulish', family: "'Mulish', sans-serif", google: 'Mulish:wght@400;500;700', group: 'Moderno' },
  { slug: 'public-sans', label: 'Public Sans', family: "'Public Sans', sans-serif", google: 'Public+Sans:wght@400;500;700', group: 'Moderno' },
  // Serifa
  { slug: 'playfair', label: 'Playfair Display', family: "'Playfair Display', Georgia, serif", google: 'Playfair+Display:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'cormorant', label: 'Cormorant Garamond', family: "'Cormorant Garamond', Georgia, serif", google: 'Cormorant+Garamond:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'cinzel', label: 'Cinzel', family: "'Cinzel', Georgia, serif", google: 'Cinzel:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'bodoni', label: 'Bodoni Moda', family: "'Bodoni Moda', Georgia, serif", google: 'Bodoni+Moda:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'dm-serif', label: 'DM Serif Display', family: "'DM Serif Display', Georgia, serif", google: 'DM+Serif+Display', group: 'Serifa' },
  { slug: 'fraunces', label: 'Fraunces', family: "'Fraunces', Georgia, serif", google: 'Fraunces:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'libre-baskerville', label: 'Libre Baskerville', family: "'Libre Baskerville', Georgia, serif", google: 'Libre+Baskerville:wght@400;700', group: 'Serifa' },
  { slug: 'spectral', label: 'Spectral', family: "'Spectral', Georgia, serif", google: 'Spectral:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'lora', label: 'Lora', family: "'Lora', Georgia, serif", google: 'Lora:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'abril-fatface', label: 'Abril Fatface', family: "'Abril Fatface', Georgia, serif", google: 'Abril+Fatface', group: 'Serifa' },
  { slug: 'italiana', label: 'Italiana', family: "'Italiana', Georgia, serif", google: 'Italiana', group: 'Serifa' },
  // Marcante
  { slug: 'anton', label: 'Anton', family: "'Anton', sans-serif", google: 'Anton', group: 'Marcante' },
  { slug: 'bebas', label: 'Bebas Neue', family: "'Bebas Neue', sans-serif", google: 'Bebas+Neue', group: 'Marcante' },
  { slug: 'oswald', label: 'Oswald', family: "'Oswald', sans-serif", google: 'Oswald:wght@400;500;600;700', group: 'Marcante' },
  { slug: 'archivo-black', label: 'Archivo Black', family: "'Archivo Black', sans-serif", google: 'Archivo+Black', group: 'Marcante' },
  { slug: 'unbounded', label: 'Unbounded', family: "'Unbounded', sans-serif", google: 'Unbounded:wght@400;500;600;700', group: 'Marcante' },
  { slug: 'syne', label: 'Syne', family: "'Syne', sans-serif", google: 'Syne:wght@400;500;600;700', group: 'Marcante' },
  { slug: 'righteous', label: 'Righteous', family: "'Righteous', sans-serif", google: 'Righteous', group: 'Marcante' },
  { slug: 'exo2', label: 'Exo 2', family: "'Exo 2', sans-serif", google: 'Exo+2:wght@400;500;600;700', group: 'Marcante' },
  // Casual
  { slug: 'poppins', label: 'Poppins', family: "'Poppins', sans-serif", google: 'Poppins:wght@400;500;600;700', group: 'Casual' },
  { slug: 'quicksand', label: 'Quicksand', family: "'Quicksand', sans-serif", google: 'Quicksand:wght@400;500;600;700', group: 'Casual' },
  { slug: 'comfortaa', label: 'Comfortaa', family: "'Comfortaa', sans-serif", google: 'Comfortaa:wght@400;500;700', group: 'Casual' },
  { slug: 'nunito', label: 'Nunito', family: "'Nunito', sans-serif", google: 'Nunito:wght@400;600;800', group: 'Casual' },
  // Mais opções
  { slug: 'plus-jakarta', label: 'Plus Jakarta Sans', family: "'Plus Jakarta Sans', sans-serif", google: 'Plus+Jakarta+Sans:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'urbanist', label: 'Urbanist', family: "'Urbanist', sans-serif", google: 'Urbanist:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'red-hat', label: 'Red Hat Display', family: "'Red Hat Display', sans-serif", google: 'Red+Hat+Display:wght@400;500;600;700', group: 'Moderno' },
  { slug: 'eb-garamond', label: 'EB Garamond', family: "'EB Garamond', Georgia, serif", google: 'EB+Garamond:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'marcellus', label: 'Marcellus', family: "'Marcellus', Georgia, serif", google: 'Marcellus', group: 'Serifa' },
  { slug: 'bitter', label: 'Bitter', family: "'Bitter', Georgia, serif", google: 'Bitter:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'zilla-slab', label: 'Zilla Slab', family: "'Zilla Slab', Georgia, serif", google: 'Zilla+Slab:wght@400;500;600;700', group: 'Serifa' },
  { slug: 'teko', label: 'Teko', family: "'Teko', sans-serif", google: 'Teko:wght@400;500;600;700', group: 'Marcante' },
  { slug: 'fjalla', label: 'Fjalla One', family: "'Fjalla One', sans-serif", google: 'Fjalla+One', group: 'Marcante' },
  { slug: 'staatliches', label: 'Staatliches', family: "'Staatliches', sans-serif", google: 'Staatliches', group: 'Marcante' },
  { slug: 'alfa-slab', label: 'Alfa Slab One', family: "'Alfa Slab One', Georgia, serif", google: 'Alfa+Slab+One', group: 'Marcante' },
  { slug: 'fredoka', label: 'Fredoka', family: "'Fredoka', sans-serif", google: 'Fredoka:wght@400;500;600;700', group: 'Casual' },
  { slug: 'baloo', label: 'Baloo 2', family: "'Baloo 2', sans-serif", google: 'Baloo+2:wght@400;500;600;700', group: 'Casual' },
  { slug: 'varela-round', label: 'Varela Round', family: "'Varela Round', sans-serif", google: 'Varela+Round', group: 'Casual' },
];

export const VALID_FONT_SLUGS = new Set(BLOG_FONTS.map((f) => f.slug));
export const DEFAULT_FONT_SLUG = 'clash';

/** Normaliza um slug recebido (fallback no default se inválido/vazio). */
export function normalizeFontSlug(slug?: string | null): string {
  return slug && VALID_FONT_SLUGS.has(slug) ? slug : DEFAULT_FONT_SLUG;
}
