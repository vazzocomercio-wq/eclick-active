import type { EmojiUsage, HashtagStrategy } from '../social.types';

export interface CreateBrandDto {
  name: string;
  slug?: string;
  description?: string;
  primary_color?: string;
  secondary_color?: string;
  logo_url?: string;
  canva_brand_kit_id?: string;
  niche?: string;
  target_audience?: string;
  value_proposition?: string;
  pain_points?: string[];
  differentials?: string[];
  main_cta?: string;
  tone_of_voice?: string;
  forbidden_words?: string[];
  preferred_words?: string[];
  emoji_usage?: EmojiUsage;
  hashtag_strategy?: HashtagStrategy;
  persona_id?: string | null;
  knowledge_categories?: string[];
  reference_accounts?: string[];
  inspiration_urls?: unknown;
}

export type UpdateBrandDto = Partial<CreateBrandDto> & { is_active?: boolean };
