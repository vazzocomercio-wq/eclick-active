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

export interface WeekDaySlot {
  weekday: string;
  product_id: string | null;
  product_name: string;
  format: SuggestionFormat;
  angle: string;
  best_time: string | null;
}

export interface WeekPlan {
  week_start: string;
  days: WeekDaySlot[];
  generated_at: string;
  cached: boolean;
}

export type RecKind = 'format' | 'timing' | 'campaign' | 'signal';
export interface Recommendation {
  id: string;
  kind: RecKind;
  severity: 'info' | 'opportunity' | 'warning';
  title: string;
  detail: string;
  action: { label: string; href: string } | null;
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

  /** Resumo orgânico pro dashboard executivo (totais/heatmap/trend/top/por formato).
   *  Vem do SaaS via bridge (dado coletado em analytics_social_posts). */
  async getOverview(orgId: string): Promise<{ organic: unknown; generated_at: string }> {
    const organic = await this.bridge.getOrganicSummary(orgId);
    return { organic, generated_at: new Date().toISOString() };
  }

  /** Feed de recomendações acionáveis (determinístico, sem custo de IA): formato
   *  campeão, melhor horário, produto que merece campanha + sinais do Active. */
  async getRecommendations(orgId: string): Promise<Recommendation[]> {
    const FMT: Record<string, string> = {
      reel: 'Reels', REELS: 'Reels', post: 'Posts', FEED: 'Feed',
      carousel: 'Carrosséis', STORY: 'Stories',
    };
    const [organic, candidates, sig] = await Promise.all([
      this.bridge.getOrganicSummary(orgId).catch(() => null),
      this.bridge.getCampaignCandidates(orgId, 'mixed', 5).catch(() => []),
      this.supabase.adminClient
        .from('social_signals')
        .select('signal_type, severity, title, description')
        .eq('org_id', orgId)
        .is('acknowledged_at', null)
        .order('detected_at', { ascending: false })
        .limit(6),
    ]);
    const recs: Recommendation[] = [];

    // 1. Formato campeão
    if (organic && organic.by_format.length >= 2) {
      const a = organic.by_format[0];
      const b = organic.by_format[1];
      if (a && b && a.avg_engagement_rate > 0 && a.avg_engagement_rate >= b.avg_engagement_rate * 1.3) {
        const ratio = b.avg_engagement_rate > 0 ? (a.avg_engagement_rate / b.avg_engagement_rate).toFixed(1) : '';
        recs.push({
          id: 'format', kind: 'format', severity: 'opportunity',
          title: `Poste mais ${FMT[a.format] ?? a.format}`,
          detail: `${FMT[a.format] ?? a.format} engajam ${ratio ? `${ratio}× ` : ''}mais que ${FMT[b.format] ?? b.format} (alcance médio ${a.avg_reach} vs ${b.avg_reach}).`,
          action: { label: 'Criar conteúdo', href: '/social/criar' },
        });
      }
    }
    // 2. Melhor horário
    if (organic?.best_hour != null) {
      recs.push({
        id: 'timing', kind: 'timing', severity: 'info',
        title: `Publique por volta das ${organic.best_hour}h`,
        detail: 'É o horário em que seu público mais engajou nos últimos 30 dias.',
        action: { label: 'Abrir calendário', href: '/social/calendario' },
      });
    }
    // 3. Produto que merece campanha
    const c = candidates[0];
    if (c) {
      recs.push({
        id: 'campaign', kind: 'campaign', severity: 'opportunity',
        title: `${c.product_name} merece campanha`,
        detail: `Margem ${c.margin_pct ?? '?'}%${c.is_overstock ? ' · estoque parado (overstock)' : ''}${c.demand_trend === 'rising' ? ' · em alta no Radar' : ''} — bom candidato pra empurrar.`,
        action: { label: 'Gerar campanha', href: '/social/campanhas' },
      });
    }
    // 4. Sinais do Active (hit/flop/spike/queda)
    const sigRows = (sig.data ?? []) as Array<{ signal_type: string; severity: string; title: string; description: string | null }>;
    sigRows.forEach((s, i) => {
      recs.push({
        id: `sig-${s.signal_type}-${i}`, kind: 'signal',
        severity: s.severity === 'critical' || s.severity === 'warning' ? 'warning' : 'info',
        title: s.title,
        detail: s.description ?? '',
        action: null,
      });
    });
    return recs;
  }

  /** Plano de conteúdo dos próximos 7 dias — a IA monta a semana com base em
   *  produtos/estoque/Radar + formato/horário que engajam. Cacheia em plan_json.week
   *  (read-merge: preserva as sugestões de "hoje"). */
  async getWeekPlan(orgId: string, refresh = false): Promise<WeekPlan> {
    const today = new Date().toISOString().slice(0, 10);
    const { data: row } = await this.supabase.adminClient
      .from('social_intelligence_daily')
      .select('plan_json')
      .eq('org_id', orgId)
      .eq('date', today)
      .maybeSingle();
    const plan = (row?.plan_json ?? {}) as { week?: WeekPlan };
    if (!refresh && plan.week?.days?.length) {
      return { ...plan.week, cached: true };
    }

    const [candidates, organic] = await Promise.all([
      this.bridge.getCampaignCandidates(orgId, 'mixed', 10).catch(() => []),
      this.bridge.getOrganicSummary(orgId).catch(() => null),
    ]);
    const days = await this.generateWeek(orgId, candidates, organic);
    const week: WeekPlan = { week_start: today, days, generated_at: new Date().toISOString(), cached: false };

    const merged = { ...((row?.plan_json as Record<string, unknown>) ?? {}), week };
    await this.supabase.adminClient
      .from('social_intelligence_daily')
      .upsert(
        { org_id: orgId, date: today, plan_json: merged, updated_at: new Date().toISOString() },
        { onConflict: 'org_id,date' },
      );
    return week;
  }

  private async generateWeek(
    orgId: string,
    candidates: Awaited<ReturnType<BridgeService['getCampaignCandidates']>>,
    organic: Awaited<ReturnType<BridgeService['getOrganicSummary']>>,
  ): Promise<WeekDaySlot[]> {
    if (!candidates.length && !(organic && organic.totals.posts > 0)) return [];

    const candText = candidates.length
      ? candidates
          .map((c, i) => `${i + 1}. ${c.product_name} | margem ${c.margin_pct ?? '?'}% | estoque ${c.stock}${c.is_overstock ? ' (OVERSTOCK)' : ''} | demanda ${c.demand_trend} [id:${c.product_id}]`)
          .join('\n')
      : '(sem candidatos comerciais)';
    const fmtHint = organic?.best_format ? `Formato que mais engaja: ${organic.best_format}. ` : '';
    const hourHint = organic?.best_hour != null ? `Melhor horário ~${organic.best_hour}h. ` : '';

    const user = [
      'Monte o PLANO DE CONTEÚDO dos próximos 7 dias (Segunda→Domingo) pra VENDER mais.',
      'Distribua os produtos candidatos pelos dias — varie produtos e ângulos, não repita o mesmo produto em dias seguidos. Priorize margem alta e estoque parado.',
      `${fmtHint}${hourHint}1 peça por dia.`,
      '',
      'PRODUTOS CANDIDATOS:',
      candText,
      '',
      'JSON: {"days":[{"weekday":"Segunda","product_id":"<id do candidato ou null>","product_name":"...","format":"reel|post|carousel","angle":"<tema/gancho>","best_time":"<ex: 19h>"}]} — exatamente 7 itens (Segunda a Domingo).',
    ].join('\n');

    try {
      const r = await this.llm.chat({
        orgId,
        feature: 'social_intelligence_today',
        system: SYSTEM_PROMPT,
        user,
        json_mode: true,
        max_tokens: 1600,
        temperature: 0.7,
      });
      const parsed = JSON.parse(r.text.replace(/```json/gi, '').replace(/```/g, '').trim()) as {
        days?: Array<Partial<WeekDaySlot>>;
      };
      return (parsed.days ?? []).slice(0, 7).map((d) => ({
        weekday: String(d.weekday ?? '').slice(0, 20),
        product_id: d.product_id ?? null,
        product_name: String(d.product_name ?? '').slice(0, 120),
        format: (['reel', 'post', 'carousel'] as const).includes(d.format as SuggestionFormat) ? (d.format as SuggestionFormat) : 'post',
        angle: String(d.angle ?? '').slice(0, 200),
        best_time: d.best_time ?? null,
      }));
    } catch (e) {
      this.log.warn(`[social-intel] week falhou: ${(e as Error).message}`);
      return [];
    }
  }

  private async generate(orgId: string, today: string): Promise<TodaysPlan> {
    const [candidates, organic] = await Promise.all([
      this.bridge.getCampaignCandidates(orgId, 'mixed', 8).catch(() => []),
      this.bridge.getOrganicSummary(orgId).catch(() => null),
    ]);

    const bestHour = organic?.best_hour ?? null;
    const bestFormat = organic?.best_format ?? null;
    const orgPosts = organic?.totals.posts ?? 0;
    const dataAvailable = candidates.length > 0 || orgPosts > 0;

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
    const formatText = organic && organic.by_format.length
      ? organic.by_format.slice(0, 5).map((f) => `${f.format}: eng ${(f.avg_engagement_rate * 100).toFixed(1)}%, alcance médio ${f.avg_reach}`).join('\n')
      : '(sem dados de formato)';
    const hourText = organic && organic.heatmap.length
      ? [...organic.heatmap].sort((a, b) => b.reach - a.reach).slice(0, 3).map((h) => `${h.hour}h`).join(', ')
      : bestHour != null ? `${bestHour}h` : '(sem dados de horário)';
    const topText = organic && organic.top_posts.length
      ? organic.top_posts.map((t) => `${t.type ?? 'POST'} "${(t.caption ?? '').slice(0, 40)}" — alcance ${t.reach}, eng ${(t.engagement_rate * 100).toFixed(1)}%`).join('\n')
      : '(sem histórico)';

    const user = [
      'Decida O QUE POSTAR HOJE pra VENDER mais. Cruze a oportunidade comercial com o que engaja.',
      '',
      'PRODUTOS CANDIDATOS (oportunidade comercial — priorize estes):',
      candText,
      '',
      'FORMATOS QUE MAIS ENGAJAM (últimos 30d):',
      formatText,
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
