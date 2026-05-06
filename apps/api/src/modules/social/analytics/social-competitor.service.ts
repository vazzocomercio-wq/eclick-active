import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialBrandsService } from '../social-brands.service';

const SYSTEM_PROMPT = `Você é um analista de marketing digital sênior. Receba dados de uma marca brasileira e os handles dos concorrentes que ela acompanha. Produza uma análise comparativa estratégica baseada em conhecimento de domínio (não tem acesso aos perfis em tempo real, então estime padrões típicos do nicho).

Retorne APENAS JSON com este shape:
{
  "summary": "1-2 frases sobre a posição da marca vs concorrentes do nicho",
  "strengths": [{ "title": "...", "description": "..." }],
  "weaknesses": [{ "title": "...", "description": "..." }],
  "opportunities": [{ "title": "...", "description": "...", "priority": "high|medium|low" }],
  "competitor_estimates": [
    { "handle": "@concorrente", "estimated_strategy": "...", "estimated_strengths": ["..."], "differentiation_opportunity": "..." }
  ],
  "recommendations": [{ "action": "...", "rationale": "...", "effort": "low|medium|high" }]
}

Diretrizes:
- 3-5 strengths/weaknesses/opportunities/recommendations
- Português brasileiro
- Honestidade: marque "estimated_*" claramente quando especular sobre concorrentes
- Foco em ação concreta, não filosofia`;

interface CompetitorAnalysis {
  id: string;
  org_id: string;
  brand_id: string;
  competitor_handles: string[];
  summary: string | null;
  strengths: unknown;
  weaknesses: unknown;
  opportunities: unknown;
  competitor_estimates: unknown;
  recommendations: unknown;
  ai_model: string | null;
  ai_generation_time_ms: number | null;
  generated_at: string;
  created_at: string;
  updated_at: string;
}

@Injectable()
export class SocialCompetitorService {
  private readonly log = new Logger(SocialCompetitorService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly brands: SocialBrandsService,
  ) {}

  /**
   * Gera nova análise via IA. Cacheada por brand_id — o último é
   * mostrado, regenerar substitui (mas histórico fica em outras rows).
   */
  async generate(
    orgId: string,
    brandId: string,
  ): Promise<CompetitorAnalysis> {
    const t0 = Date.now();
    const brand = await this.brands.findById(orgId, brandId);
    if (brand.reference_accounts.length === 0) {
      throw new BadRequestException(
        'Cadastre concorrentes em reference_accounts da marca primeiro',
      );
    }

    const ctx = await this.brands.getContext(orgId, brandId);
    const userPrompt = [
      `MARCA: ${ctx.identity.name}`,
      ctx.identity.niche ? `Nicho: ${ctx.identity.niche}` : '',
      ctx.identity.target_audience
        ? `Público: ${ctx.identity.target_audience}`
        : '',
      ctx.identity.value_proposition
        ? `Proposta: ${ctx.identity.value_proposition}`
        : '',
      ctx.business.differentials.length > 0
        ? `Diferenciais: ${ctx.business.differentials.join('; ')}`
        : '',
      `Tom: ${ctx.identity.tone}`,
      '',
      `CONCORRENTES MONITORADOS: ${brand.reference_accounts.join(', ')}`,
      '',
      'Analise pontos fortes/fracos da marca em relação aos concorrentes,'
        + ' identifique oportunidades de diferenciação e gere recomendações concretas.',
    ]
      .filter(Boolean)
      .join('\n');

    const result = await this.llm.chat({
      orgId,
      feature: 'social_competitor_analysis',
      system: SYSTEM_PROMPT,
      user: userPrompt,
      json_mode: true,
      max_tokens: 3000,
      temperature: 0.5,
    });

    const parsed = this.parseJson(result.text) as Record<string, unknown> | null;
    if (!parsed) {
      throw new Error('IA retornou JSON inválido');
    }

    const { data, error } = await this.supabase.adminClient
      .from('social_competitor_analyses')
      .insert({
        org_id: orgId,
        brand_id: brandId,
        competitor_handles: brand.reference_accounts,
        summary:
          typeof parsed.summary === 'string' ? parsed.summary : null,
        strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
        weaknesses: Array.isArray(parsed.weaknesses) ? parsed.weaknesses : [],
        opportunities: Array.isArray(parsed.opportunities)
          ? parsed.opportunities
          : [],
        competitor_estimates: Array.isArray(parsed.competitor_estimates)
          ? parsed.competitor_estimates
          : [],
        recommendations: Array.isArray(parsed.recommendations)
          ? parsed.recommendations
          : [],
        ai_model: 'claude-sonnet',
        ai_generation_time_ms: Date.now() - t0,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as CompetitorAnalysis;
  }

  async latest(
    orgId: string,
    brandId: string,
  ): Promise<CompetitorAnalysis | null> {
    const { data } = await this.supabase.adminClient
      .from('social_competitor_analyses')
      .select('*')
      .eq('org_id', orgId)
      .eq('brand_id', brandId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as CompetitorAnalysis | null) ?? null;
  }

  async findById(orgId: string, id: string): Promise<CompetitorAnalysis> {
    const { data } = await this.supabase.adminClient
      .from('social_competitor_analyses')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Análise não encontrada');
    return data as CompetitorAnalysis;
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

export type { CompetitorAnalysis };
