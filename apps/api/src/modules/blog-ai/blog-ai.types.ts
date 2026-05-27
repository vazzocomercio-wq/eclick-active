/**
 * Tipos do módulo Blog IA.
 *
 * A IA (LlmService, json_mode) devolve `RawArticle` — um shape simples
 * (seções + blocos), que o service converte pra Portable Text do Sanity
 * (controlando _key/_type). Mantém o output da IA fácil de validar.
 */

// ── DTO (frontend → API) ──────────────────────────────────────────────
export interface GenerateBlogPostDto {
  /** Tema/pauta livre (ex: "Como estruturar título de anúncio pra IA citar"). */
  topic: string;
  /** Slug do pilar editorial (geo-101, ciencia-aplicada, como-fazer, cases, …). */
  pillar?: string;
  /** Direções extras opcionais (tom, ângulo, dados a incluir). */
  notes?: string;
  /** Gera capa por IA (default true). */
  generateCover?: boolean;
}

export interface IdeateDto {
  /** Semente/foco opcional (ex: "Shopee", "frete", "lançamento"). */
  seed?: string;
  /** Quantas pautas (default 5, máx 10). */
  count?: number;
}

export interface BlogTopicIdea {
  title: string;
  pillar: string;
  angle: string;
  why: string;
  aiPrompts: string[];
}

// ── Shape cru que a IA retorna ────────────────────────────────────────
export interface RawArticleBlock {
  type: 'stat' | 'paperQuote' | 'callout' | 'comparison';
  // stat
  value?: string;
  label?: string;
  source?: string;
  // paperQuote
  quote?: string;
  paperTitle?: string;
  authors?: string;
  venue?: string;
  url?: string;
  // callout
  variant?: 'info' | 'warning' | 'tip' | 'science' | 'case';
  title?: string;
  body?: string;
  // comparison
  leftLabel?: string;
  rightLabel?: string;
  rows?: Array<{ aspect?: string; left?: string; right?: string }>;
}

export interface RawArticleSection {
  /** Vira um H2 no corpo. */
  heading?: string;
  paragraphs?: string[];
  /** Blocos especiais ao fim da seção. */
  blocks?: RawArticleBlock[];
}

export interface RawArticle {
  title: string;
  slug?: string;
  excerpt: string;
  tldr: string[];
  sections: RawArticleSection[];
  faq?: Array<{ question: string; answer: string }>;
  aiPrompts?: string[];
  citationSources?: Array<{ title: string; url?: string; authorOrOrg?: string; year?: number }>;
  tags?: string[];
  seoTitle?: string;
  metaDescription?: string;
  focusKeyword?: string;
  coverImagePrompt?: string;
  readingTimeMinutes?: number;
}

// ── Portable Text (Sanity) ────────────────────────────────────────────
export interface PortableTextSpan {
  _type: 'span';
  _key: string;
  text: string;
  marks: string[];
}
export interface PortableTextNode {
  _type: string;
  _key: string;
  [k: string]: unknown;
}

// ── Linha da tabela active.blog_posts ─────────────────────────────────
export type BlogPostStatus =
  | 'generating'
  | 'review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'failed'
  | 'archived';

export interface BlogPostRow {
  id: string;
  org_id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  tldr: string[];
  body: PortableTextNode[];
  faq: Array<{ question: string; answer: string }>;
  ai_prompts: string[];
  citation_sources: Array<{ title: string; url?: string; authorOrOrg?: string; year?: number }>;
  category: string | null;
  tags: string[];
  cover_image_url: string | null;
  seo_title: string | null;
  meta_description: string | null;
  focus_keyword: string | null;
  reading_time_minutes: number | null;
  status: BlogPostStatus;
  scheduled_for: string | null;
  sanity_doc_id: string | null;
  published_at: string | null;
  rejected_reason: string | null;
  source_topic: string | null;
  pillar: string | null;
  cost_usd: number;
  generation_metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}
