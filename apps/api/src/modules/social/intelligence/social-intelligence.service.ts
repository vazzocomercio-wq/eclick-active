import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { LlmService } from '../../../common/llm/llm.service';
import { BridgeService } from '../../bridge/bridge.service';
import { SocialMetricsService } from '../analytics/social-metrics.service';

export type SuggestionFormat = 'reel' | 'post' | 'carousel';

export interface TodaySuggestion {
  product_id: string | null;
  product_name: string;
  format: SuggestionFormat;
  angle: string;
  why: string;
  best_time: string | null;
  photo_url: string | null;
}

export interface TodaySignals {
  candidates: number;
  best_format: string | null;
  best_hour: number | null;
  data_available: boolean;
}

export interface TodaysPlan {
  date: string;
  suggestions: TodaySuggestion[];
  signals: TodaySignals;
  generated_at: string;
  cached: boolean;
}

const SYSTEM_PROMPT = `Você é o estrategista de conteúdo de uma loja de e-commerce no e-Click.
Sua missão: decidir O QUE POSTAR HOJE nas redes pra VENDER mais — cruzando a
OPORTUNIDADE COMERCIAL (margem, estoque, overstock, demanda/tendência) com o que
ENGAJA (formato, horário, posts que já bombaram). Priorize produtos com boa margem
e/ou estoque parado (overstock) que tenham potencial de engajamento. Seja concreto e
comercial — nada genérico. Cada sugestão deve justificar POR QUE este produto, neste
formato, hoje. Responda SEMPRE só com JSON válido.`;

/**
 * E-Click Social Intelligence — cérebro "O que postar hoje".
 * Cruza candidatos comerciais (bridge SaaS: margem/estoque/Radar) com sinais de
 * engajamento (melhor formato/horário/top posts) e a IA devolve 3 sugestões
 * priorizadas. Cacheia 1×/dia por org pra não re-gastar IA.
 */
@Injectable()
export class SocialIntelligenceService {
  private readonly log = new Logger(SocialIntelligenceService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly llm: LlmService,
    private readonly bridge: BridgeService,
    private readonly metrics: SocialMetricsService,
  ) {}

  async getTodaysPlan(orgId: string, refresh = false): Promise<TodaysPlan> {
    const today = new Date().toISOString().slice(0, 10);

    if (!refresh) {
      const { data } = await this.supabase.adminClient
        .from('social_intelligence_daily')
        .select('plan_json, signals_json, generated_at')
        .eq('org_id', orgId)
        .eq('date', today)
        .maybeSingle();
      if (data) {
        const plan = (data.plan_json ?? {}) as { suggestions?: TodaySuggestion[] };
        const signals = (data.signals_json ?? {}) as TodaySignals;
        return {
          date: today,
          suggestions: plan.suggestions ?? [],
          signals,
          generated_at: data.generated_at as string,
          cached: true,
        };
      }
    }
    return this.generate(orgId, today);
  }

  private async generate(orgId: string, today: string): Promise<TodaysPlan> {
    const [candidates, byPillar, byHour, top] = await Promise.all([
      this.bridge.getCampaignCandidates(orgId, 'mixed', 8).catch(() => []),
      this.metrics.getByPillar(orgId, 30).catch(() => []),
      this.metrics.getByHour(orgId, 30).catch(() => []),
      this.metrics.getTopPerformers(orgId, 30, undefined, 5).catch(() => []),
    ]);

    const hoursByEng = [...byHour].sort((a, b) => b.avg_engagement_rate - a.avg_engagement_rate);
    const bestHour = hoursByEng[0]?.hour_of_day ?? null;
    const bestFormat = top[0]?.content_type ?? byPillar[0]?.pillar ?? null;
    const dataAvailable = candidates.length > 0 || byPillar.length > 0 || top.length > 0;

    const signals: TodaySignals = {
      candidates: candidates.length,
      best_format: bestFormat,
      best_hour: bestHour,
      data_available: dataAvailable,
    };

    if (!dataAvailable) {
      await this.cache(orgId, today, { suggestions: [] }, signals, 0);
      return { date: today, suggestions: [], signals, generated_at: new Date().toISOString(), cached: false };
    }

    const candText = candidates.length
      ? candidates
          .map(
            (c, i) =>
              `${i + 1}. ${c.product_name} | margem ${c.margin_pct ?? '?'}% | estoque ${c.stock}` +
              `${c.is_overstock ? ' (OVERSTOCK)' : ''} | demanda ${c.demand_trend}` +
              `${c.days_since_movement != null ? ` | ${c.days_since_movement}d sem venda` : ''} [id:${c.product_id}]`,
          )
          .join('\n')
      : '(sem candidatos comerciais — sugira com base no engajamento)';
    const pillarText = byPillar.length
      ? byPillar.slice(0, 5).map((p) => `${p.pillar}: eng ${(p.avg_engagement_rate * 100).toFixed(1)}%, alcance médio ${Math.round(p.avg_reach)}`).join('\n')
      : '(sem dados de formato)';
    const hourText = hoursByEng.length
      ? hoursByEng.slice(0, 3).map((h) => `${h.hour_of_day}h (eng ${(h.avg_engagement_rate * 100).toFixed(1)}%)`).join(', ')
      : '(sem dados de horário)';
    const topText = top.length
      ? top.map((t) => `${t.content_type} "${(t.title ?? '').slice(0, 40)}" — alcance ${t.total_reach}, eng ${(t.avg_engagement_rate * 100).toFixed(1)}%`).join('\n')
      : '(sem histórico)';

    const user = [
      'Decida O QUE POSTAR HOJE pra VENDER mais. Cruze a oportunidade comercial com o que engaja.',
      '',
      'PRODUTOS CANDIDATOS (oportunidade comercial — priorize estes):',
      candText,
      '',
      'PILARES/TEMAS QUE MAIS ENGAJAM (últimos 30d):',
      pillarText,
      '',
      `MELHORES HORÁRIOS: ${hourText}`,
      '',
      'POSTS QUE JÁ BOMBARAM (com tipo de mídia):',
      topText,
      '',
      'Gere EXATAMENTE 3 sugestões priorizadas (a 1ª = a melhor aposta de hoje). JSON:',
      '{"suggestions":[{"product_id":"<id do candidato ou null>","product_name":"...","format":"reel|post|carousel","angle":"<gancho/tema do conteúdo>","why":"<por que ESTE produto, formato e horário HOJE — cite margem/estoque/engajamento concretos>","best_time":"<ex: 19h ou null>"}]}',
    ].join('\n');

    let suggestions: TodaySuggestion[] = [];
    let cost = 0;
    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'social_intelligence_today',
        system: SYSTEM_PROMPT,
        user,
        json_mode: true,
        max_tokens: 1200,
        temperature: 0.7,
      });
      cost = (r as { cost_usd?: number }).cost_usd ?? 0;
      const parsed = JSON.parse(r.text.replace(/```json/gi, '').replace(/```/g, '').trim()) as {
        suggestions?: Array<Partial<TodaySuggestion>>;
      };
      suggestions = (parsed.suggestions ?? []).slice(0, 3).map((s) => {
        const fmt = (['reel', 'post', 'carousel'] as const).includes(s.format as SuggestionFormat)
          ? (s.format as SuggestionFormat)
          : 'post';
        const pid = s.product_id ?? null;
        return {
          product_id: pid,
          product_name: String(s.product_name ?? '').slice(0, 120),
          format: fmt,
          angle: String(s.angle ?? '').slice(0, 200),
          why: String(s.why ?? '').slice(0, 300),
          best_time: s.best_time ?? null,
          photo_url: candidates.find((c) => c.product_id === pid)?.product_photo_url ?? null,
        };
      });
    } catch (e) {
      this.log.warn(`[social-intel] geração falhou: ${(e as Error).message}`);
    }

    await this.cache(orgId, today, { suggestions }, signals, cost);
    return { date: today, suggestions, signals, generated_at: new Date().toISOString(), cached: false };
  }

  private async cache(
    orgId: string,
    today: string,
    plan: { suggestions: TodaySuggestion[] },
    signals: TodaySignals,
    cost: number,
  ): Promise<void> {
    await this.supabase.adminClient
      .from('social_intelligence_daily')
      .upsert(
        {
          org_id: orgId,
          date: today,
          plan_json: plan,
          signals_json: signals,
          cost_usd: cost,
          generated_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'org_id,date' },
      );
  }
}
