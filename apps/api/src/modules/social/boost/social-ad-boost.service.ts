import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { SocialBrandsService } from '../social-brands.service';
import { SocialContentsService } from '../social-contents.service';
import { SocialMetricsService } from '../analytics/social-metrics.service';
import type {
  SocialAdBoostDraft,
  BoostSuggestion,
  BoostObjective,
  BoostStatus,
} from './social-ad-boost.types';
import type { SocialContent, ContentPillar } from '../social.types';

const SUGGEST_SYSTEM_PROMPT = `Você é um especialista em Meta Ads pra negócios brasileiros. Receba um post que performou bem (hit) e sugira como promovê-lo como ad.

Diretrizes:
- Budget realista pra PME brasileira (R$ 30-200/dia, dependendo do nicho)
- Audiência: idade, gênero, localização, interesses (use taxonomy do Facebook Ads)
- Objective alinhado ao pilar do post
- 2 variações de caption otimizadas pra ad (mais diretas que orgânico, com CTA forte)

Retorne APENAS JSON com este shape:
{
  "daily_budget_brl": number (em reais, ex: 50),
  "budget_rationale": "string explicando porque esse budget faz sentido",
  "duration_days": number (3-14),
  "objective": "OUTCOME_AWARENESS" | "OUTCOME_TRAFFIC" | "OUTCOME_ENGAGEMENT" | "OUTCOME_LEADS" | "OUTCOME_APP_PROMOTION" | "OUTCOME_SALES",
  "audience_summary": "string em PT-BR descrevendo a audiência ideal",
  "age_min": number,
  "age_max": number,
  "genders": ["male", "female"] ou ["all"],
  "interests": [string array — interesses do Facebook Ads],
  "locations": [string array — cidades/estados/países],
  "copy_suggestions": [
    { "caption": "...", "reason": "porque essa funciona" },
    { "caption": "...", "reason": "..." }
  ]
}`;

const PILLAR_OBJECTIVE_MAP: Record<ContentPillar, BoostObjective> = {
  educational: 'OUTCOME_TRAFFIC',
  promotional: 'OUTCOME_SALES',
  social_proof: 'OUTCOME_ENGAGEMENT',
  entertainment: 'OUTCOME_AWARENESS',
  institutional: 'OUTCOME_AWARENESS',
  engagement: 'OUTCOME_ENGAGEMENT',
  product: 'OUTCOME_SALES',
  behind_scenes: 'OUTCOME_ENGAGEMENT',
};

/**
 * Service de boost: promover post como ad.
 *
 * Estratégia MVP:
 *   1. Quando hit_post detectado OU usuário clica "Promover como ad",
 *      chama IA pra gerar sugestão (budget, audiência, copy).
 *   2. Cria draft em social_ad_boost_drafts.
 *   3. Gera deep link pro Meta Ads Manager pré-preenchido com:
 *      - source_post_id (instagram_business_post_id existente)
 *      - objective sugerido
 *      - daily_budget
 *   4. Usuário abre o link, revisa, ativa manualmente.
 *
 * NÃO cria campanha automaticamente no Meta — evita gastar dinheiro
 * sem confirmação e simplifica o caminho legal (cada org precisa do
 * próprio Ads Manager configurado).
 */
@Injectable()
export class SocialAdBoostService {
  private readonly log = new Logger(SocialAdBoostService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly brands: SocialBrandsService,
    private readonly contents: SocialContentsService,
    private readonly metrics: SocialMetricsService,
  ) {}

  /**
   * Gera sugestão de boost via IA com base no contexto da marca +
   * performance do post. Retorna sem persistir.
   */
  async suggestBoost(
    orgId: string,
    contentId: string,
  ): Promise<BoostSuggestion> {
    const content = await this.contents.findById(orgId, contentId);
    const brandCtx = await this.brands.getContext(orgId, content.brand_id);
    const metricsRows = await this.metrics.getMetricsForContent(orgId, contentId);

    // Resumo de performance
    const lastRow = metricsRows[metricsRows.length - 1];
    const performance = lastRow
      ? `Performance: reach=${lastRow.reach}, likes=${lastRow.likes}, comments=${lastRow.comments}, saved=${lastRow.saved}, engagement_rate=${(lastRow.engagement_rate * 100).toFixed(2)}%`
      : 'Sem métricas ainda — usando heurísticas baseadas em pilar/marca.';

    const userPrompt = [
      `MARCA: ${brandCtx.identity.name} — ${brandCtx.identity.niche ?? 'nicho não informado'}`,
      `Público da marca: ${brandCtx.identity.target_audience ?? '—'}`,
      `Proposta: ${brandCtx.identity.value_proposition ?? '—'}`,
      brandCtx.business.differentials.length > 0
        ? `Diferenciais: ${brandCtx.business.differentials.join('; ')}`
        : '',
      '',
      `POST:`,
      `Pilar: ${content.pillar ?? 'general'}`,
      `Tipo: ${content.content_type}`,
      `Caption: ${(content.caption ?? '').slice(0, 500)}`,
      `Hashtags: ${content.hashtags.join(' ')}`,
      content.cta ? `CTA: ${content.cta}` : '',
      '',
      performance,
      '',
      'Sugira como promover este post como ad. Retorne JSON.',
    ]
      .filter(Boolean)
      .join('\n');

    try {
      const result = await this.llm.chat({
        orgId,
        feature: 'social_ad_boost_suggest',
        system: SUGGEST_SYSTEM_PROMPT,
        user: userPrompt,
        json_mode: true,
        max_tokens: 1500,
        temperature: 0.4,
      });

      const parsed = this.parseJson(result.text);
      if (parsed && typeof parsed === 'object') {
        return this.normalizeSuggestion(parsed as Record<string, unknown>, content);
      }
    } catch (err) {
      this.log.warn(`suggestBoost falhou: ${String(err)}`);
    }

    // Fallback: heurística baseada no pilar
    return this.heuristicSuggestion(content);
  }

  /**
   * Cria draft persistido a partir de uma sugestão. Quando vem de
   * signal hit_post, signalId vincula pra rastrear correlação.
   */
  async createDraft(
    orgId: string,
    contentId: string,
    options: {
      suggestion?: BoostSuggestion;
      signal_id?: string;
      user_id?: string;
    } = {},
  ): Promise<SocialAdBoostDraft> {
    const content = await this.contents.findById(orgId, contentId);
    const suggestion = options.suggestion ?? (await this.suggestBoost(orgId, contentId));

    const externalIds = content.external_post_ids as Record<string, string>;
    const igPostId = externalIds.instagram_business ?? null;

    // Deep link pro Meta Ads Manager. Quando há ig_post_id, abre o
    // composer pré-selecionando o post como source. Sem post_id, abre
    // criação genérica de campaign.
    const deepLink = this.buildMetaDeepLink({
      objective: suggestion.objective,
      ig_post_id: igPostId,
    });

    const { data, error } = await this.supabase.adminClient
      .from('social_ad_boost_drafts')
      .insert({
        org_id: orgId,
        content_id: contentId,
        brand_id: content.brand_id,
        signal_id: options.signal_id ?? null,
        platform: 'meta',
        objective: suggestion.objective,
        daily_budget_cents: suggestion.daily_budget_cents,
        duration_days: suggestion.duration_days,
        target_locations: suggestion.locations,
        target_age_min: suggestion.age_min,
        target_age_max: suggestion.age_max,
        target_genders: suggestion.genders,
        target_interests: suggestion.interests,
        target_audience_summary: suggestion.audience_summary,
        ai_budget_rationale: suggestion.budget_rationale,
        ai_audience_rationale: suggestion.audience_summary,
        ai_copy_suggestions: suggestion.copy_suggestions,
        meta_deep_link: deepLink,
        status: 'draft' as BoostStatus,
        reviewed_by: options.user_id ?? null,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialAdBoostDraft;
  }

  async listDrafts(
    orgId: string,
    filters: { status?: BoostStatus; content_id?: string } = {},
  ): Promise<SocialAdBoostDraft[]> {
    let q = this.supabase.adminClient
      .from('social_ad_boost_drafts')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (filters.status) q = q.eq('status', filters.status);
    if (filters.content_id) q = q.eq('content_id', filters.content_id);
    const { data } = await q;
    return (data ?? []) as SocialAdBoostDraft[];
  }

  async findById(orgId: string, id: string): Promise<SocialAdBoostDraft> {
    const { data } = await this.supabase.adminClient
      .from('social_ad_boost_drafts')
      .select('*')
      .eq('id', id)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Draft não encontrado');
    return data as SocialAdBoostDraft;
  }

  async updateDraft(
    orgId: string,
    id: string,
    patch: Partial<SocialAdBoostDraft>,
  ): Promise<SocialAdBoostDraft> {
    const { data, error } = await this.supabase.adminClient
      .from('social_ad_boost_drafts')
      .update(patch)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SocialAdBoostDraft;
  }

  async markSentToPlatform(orgId: string, id: string): Promise<SocialAdBoostDraft> {
    return this.updateDraft(orgId, id, {
      status: 'sent_to_platform',
      sent_to_platform_at: new Date().toISOString(),
    });
  }

  async deleteDraft(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('social_ad_boost_drafts')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }

  // ─── helpers ──────────────────────────────────

  private normalizeSuggestion(
    raw: Record<string, unknown>,
    content: SocialContent,
  ): BoostSuggestion {
    const fallback = this.heuristicSuggestion(content);
    const dailyBrl =
      typeof raw.daily_budget_brl === 'number' ? raw.daily_budget_brl : 50;
    return {
      daily_budget_cents: Math.round(dailyBrl * 100),
      budget_rationale:
        typeof raw.budget_rationale === 'string'
          ? raw.budget_rationale
          : fallback.budget_rationale,
      duration_days:
        typeof raw.duration_days === 'number' ? raw.duration_days : 7,
      objective:
        typeof raw.objective === 'string'
          ? (raw.objective as BoostObjective)
          : fallback.objective,
      audience_summary:
        typeof raw.audience_summary === 'string'
          ? raw.audience_summary
          : fallback.audience_summary,
      age_min: typeof raw.age_min === 'number' ? raw.age_min : 18,
      age_max: typeof raw.age_max === 'number' ? raw.age_max : 55,
      genders: Array.isArray(raw.genders)
        ? (raw.genders as string[])
        : ['all'],
      interests: Array.isArray(raw.interests)
        ? (raw.interests as string[])
        : [],
      locations: Array.isArray(raw.locations)
        ? (raw.locations as string[])
        : ['Brasil'],
      copy_suggestions: Array.isArray(raw.copy_suggestions)
        ? (raw.copy_suggestions as Array<{ caption: string; reason: string }>)
        : fallback.copy_suggestions,
    };
  }

  private heuristicSuggestion(content: SocialContent): BoostSuggestion {
    const objective = content.pillar
      ? PILLAR_OBJECTIVE_MAP[content.pillar]
      : 'OUTCOME_ENGAGEMENT';
    return {
      daily_budget_cents: 5000, // R$ 50/dia
      budget_rationale:
        'Budget conservador inicial pra testar tração. Aumente após 3 dias se CTR ≥ 1%.',
      duration_days: 7,
      objective,
      audience_summary: 'Audiência ampla baseada na marca — ajuste após performance inicial',
      age_min: 18,
      age_max: 55,
      genders: ['all'],
      interests: [],
      locations: ['Brasil'],
      copy_suggestions: [
        {
          caption: (content.caption ?? '').slice(0, 250),
          reason: 'Mantém a copy orgânica que já performou',
        },
      ],
    };
  }

  /**
   * Gera deep link pro Meta Ads Manager. URL pattern:
   *   https://www.facebook.com/adsmanager/manage/campaigns/edit?act=...&objective=...
   * Sem ig_post_id, abre criação genérica. Com ig_post_id, vai pro
   * "Boost Post" flow.
   */
  private buildMetaDeepLink(opts: {
    objective: BoostObjective;
    ig_post_id?: string | null;
  }): string {
    if (opts.ig_post_id) {
      return `https://www.facebook.com/adsmanager/creation/creation/?objective=${opts.objective}&source_post_id=${opts.ig_post_id}`;
    }
    return `https://www.facebook.com/adsmanager/creation/creation/?objective=${opts.objective}`;
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
