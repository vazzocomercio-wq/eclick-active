import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialBrandsService } from '../social-brands.service';

export interface HashtagTopRow {
  hashtag: string;
  total_uses: number;
  avg_engagement_rate: number;
  avg_reach: number;
  avg_likes: number;
  total_interactions: number;
}

export interface HashtagDetailRow {
  content_id: string;
  title: string | null;
  pillar: string | null;
  cover_image_url: string | null;
  engagement_rate: number;
  reach: number;
  total_interactions: number;
  published_at: string;
}

export interface HashtagSuggestion {
  hashtags: string[];
  rationale: string;
  /** Mistura: niche (5-10K), broad (>500K), top performers da própria conta. */
  mix: 'niche' | 'broad' | 'mixed' | 'minimal';
}

const SUGGEST_SYSTEM_PROMPT = `Você é um especialista em hashtags para Instagram brasileiro. Sugira hashtags relevantes baseadas em:
1. Tema do post
2. Nicho da marca
3. Hashtags que historicamente performaram bem na conta

Diretrizes:
- 8-15 hashtags
- Mistura: niche tags (5-50K posts), broad tags (500K+), branded tag se houver
- Português brasileiro
- Sem hashtags banidas/spam
- Sem # no início (vamos prefixar)

Retorne APENAS JSON:
{
  "hashtags": [string array — só nomes, sem #],
  "rationale": "1-2 frases explicando a estratégia",
  "mix": "niche" | "broad" | "mixed" | "minimal"
}`;

@Injectable()
export class SocialHashtagsService {
  private readonly log = new Logger(SocialHashtagsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly brands: SocialBrandsService,
  ) {}

  async top(
    orgId: string,
    opts: { brand_id?: string; days?: number; limit?: number } = {},
  ): Promise<HashtagTopRow[]> {
    const { data } = await this.supabase.adminClient.rpc('social_hashtag_top', {
      p_org_id: orgId,
      p_brand_id: opts.brand_id ?? null,
      p_since_days: opts.days ?? 60,
      p_limit: opts.limit ?? 20,
      p_min_uses: 2,
    });
    return (data ?? []) as HashtagTopRow[];
  }

  async detail(
    orgId: string,
    hashtag: string,
    opts: { brand_id?: string; days?: number } = {},
  ): Promise<HashtagDetailRow[]> {
    const { data } = await this.supabase.adminClient.rpc(
      'social_hashtag_detail',
      {
        p_org_id: orgId,
        p_hashtag: hashtag,
        p_brand_id: opts.brand_id ?? null,
        p_since_days: opts.days ?? 60,
      },
    );
    return (data ?? []) as HashtagDetailRow[];
  }

  /**
   * Sugere hashtags via IA com base no tema + contexto da marca + top
   * historic da conta. Retorna fallback heurístico se IA falhar.
   */
  async suggest(
    orgId: string,
    input: { theme: string; brand_id: string },
  ): Promise<HashtagSuggestion> {
    try {
      const ctx = await this.brands.getContext(orgId, input.brand_id);
      const topHistoric = await this.top(orgId, {
        brand_id: input.brand_id,
        days: 60,
        limit: 10,
      });

      const userPrompt = [
        `MARCA: ${ctx.identity.name}`,
        ctx.identity.niche ? `Nicho: ${ctx.identity.niche}` : '',
        ctx.identity.target_audience
          ? `Público: ${ctx.identity.target_audience}`
          : '',
        `Estratégia preferida: ${ctx.content_rules.hashtag_strategy}`,
        '',
        `TEMA DO POST: ${input.theme}`,
        '',
        topHistoric.length > 0
          ? `HASHTAGS QUE FUNCIONARAM HISTORICAMENTE:\n${topHistoric
              .slice(0, 8)
              .map(
                (h) =>
                  `- #${h.hashtag} (${h.total_uses}x, engagement médio ${(h.avg_engagement_rate * 100).toFixed(2)}%)`,
              )
              .join('\n')}`
          : '(Sem dados históricos ainda — sugira baseado no nicho e tema)',
      ]
        .filter(Boolean)
        .join('\n');

      const result = await this.llm.chat({
        orgId,
        feature: 'social_hashtag_suggest',
        system: SUGGEST_SYSTEM_PROMPT,
        user: userPrompt,
        json_mode: true,
        max_tokens: 800,
        temperature: 0.5,
      });

      const parsed = this.parseJson(result.text);
      if (parsed && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>;
        if (Array.isArray(obj.hashtags)) {
          return {
            hashtags: obj.hashtags
              .filter((h): h is string => typeof h === 'string')
              .map((h) => h.replace(/^#/, '').trim())
              .filter((h) => h.length > 1)
              .slice(0, 15),
            rationale:
              typeof obj.rationale === 'string'
                ? obj.rationale
                : 'Sugestão baseada no nicho da marca',
            mix:
              obj.mix === 'niche' ||
              obj.mix === 'broad' ||
              obj.mix === 'mixed' ||
              obj.mix === 'minimal'
                ? obj.mix
                : ctx.content_rules.hashtag_strategy,
          };
        }
      }
    } catch (err) {
      this.log.warn(`suggest hashtag falhou: ${String(err)}`);
    }

    // Fallback heurístico
    return {
      hashtags: ['marketing', 'instagram', 'brasil', 'empreendedorismo'],
      rationale: 'Hashtags genéricas — IA indisponível',
      mix: 'minimal',
    };
  }

  private parseJson(raw: string): unknown {
    if (!raw) return null;
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
    const candidate = fenced ? fenced[1] : trimmed;
    try {
      return JSON.parse(candidate);
    } catch {
      const m = /\{[\s\S]*\}/.exec(candidate);
      if (m) {
        try {
          return JSON.parse(m[0]);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
