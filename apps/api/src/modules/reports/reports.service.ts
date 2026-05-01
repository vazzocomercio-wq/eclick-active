import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { AnthropicClient } from '../ai/anthropic.client';
import type { ReportType } from './dto/interpret.dto';

// ──────────────────────────────────────────────────────────
// Tipos retornados
// ──────────────────────────────────────────────────────────

export interface SalesReport {
  period: { from: string; to: string };
  totals: {
    revenue: number;
    deals_won: number;
    deals_lost: number;
    deals_open: number;
    avg_ticket: number;
    conversion_rate: number;
    avg_cycle_days: number | null;
  };
  /** Série semanal de ganhos vs perdidos */
  weekly_series: Array<{
    week_start: string;
    won: number;
    lost: number;
    revenue: number;
  }>;
  /** Receita acumulada (cumulative) por dia */
  revenue_cumulative: Array<{ date: string; revenue: number }>;
  /** Top 5 motivos de perda */
  lost_reasons: Array<{ reason: string; count: number }>;
}

export interface AgentReport {
  period: { from: string; to: string };
  agents: Array<{
    user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    conversations_handled: number;
    avg_first_response_ms: number | null;
    deals_won: number;
    deals_lost: number;
    revenue: number;
    tasks_completed: number;
    ai_score: number | null;
  }>;
}

export interface ChannelReport {
  period: { from: string; to: string };
  channels: Array<{
    channel_type: string;
    conversations: number;
    leads: number;
    /** % de conversões: deals criados / conversas */
    conversion_rate: number;
  }>;
  total_conversations: number;
}

export interface FunnelReport {
  period: { from: string; to: string };
  pipeline: { id: string; name: string };
  stages: Array<{
    id: string;
    name: string;
    color: string;
    position: number;
    is_won: boolean;
    is_lost: boolean;
    deals_count: number;
    total_value: number;
    avg_time_in_stage_hours: number | null;
    /** % de deals que avançaram para o próximo stage */
    conversion_rate: number | null;
    /** % que pararam aqui (drop-off) */
    drop_off_rate: number | null;
  }>;
  /** stage com maior drop-off — destacado em vermelho na UI */
  bottleneck_stage_id: string | null;
}

export interface InterpretResult {
  summary: string;
  insights: string[];
  recommendations: string[];
}

// ──────────────────────────────────────────────────────────
// Schemas para output_config (interpret)
// ──────────────────────────────────────────────────────────

const INTERPRET_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    insights: { type: 'array', items: { type: 'string' } },
    recommendations: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'insights', 'recommendations'],
  additionalProperties: false,
} as const;

const INTERPRET_SYSTEM_PROMPT = `Você é um analista comercial sênior com expertise em CRM brasileiro.
Interprete os dados do relatório e gere insights acionáveis em português brasileiro.

Diretrizes:
- summary: 1 frase com a mensagem principal (até 140 caracteres)
- insights: 3-5 observações concretas. Cada uma cita números do relatório.
  Use bullets curtos (até 120 chars). Foque no que está funcionando E
  no que precisa melhorar.
- recommendations: 2-3 ações concretas. Comece com verbo no infinitivo
  ("Reativar leads X", "Treinar agente Y em objeção Z"). Cada uma deve
  ter um "como" claro, não conselhos genéricos.

Formate valores monetários como "R$ 12.345" (sem decimais para milhares).
Retorne APENAS JSON válido com a forma { summary, insights[], recommendations[] }.`;

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly anthropic: AnthropicClient,
  ) {}

  // ────────────────────────────────────────────
  // SALES
  // ────────────────────────────────────────────

  async getSalesReport(orgId: string, period: PeriodInput): Promise<SalesReport> {
    const { fromIso, toIso } = resolvePeriod(period);

    // Pega todos os deals criados OU fechados no período (cobre análise completa)
    const { data: deals, error } = await this.supabase.adminClient
      .from('deals')
      .select('id, value, won_at, lost_at, lost_reason, created_at')
      .eq('org_id', orgId)
      .or(
        `and(created_at.gte.${fromIso},created_at.lte.${toIso}),and(won_at.gte.${fromIso},won_at.lte.${toIso}),and(lost_at.gte.${fromIso},lost_at.lte.${toIso})`,
      );

    if (error) {
      this.logger.error(`getSalesReport failed: ${error.message}`);
      throw new InternalServerErrorException(error.message);
    }

    const rows = (deals ?? []) as Array<{
      id: string;
      value: number;
      won_at: string | null;
      lost_at: string | null;
      lost_reason: string | null;
      created_at: string;
    }>;

    const wonInPeriod = rows.filter(
      (d) => d.won_at && d.won_at >= fromIso && d.won_at <= toIso,
    );
    const lostInPeriod = rows.filter(
      (d) => d.lost_at && d.lost_at >= fromIso && d.lost_at <= toIso,
    );

    // Open: criados no período E não fechados ainda
    const openInPeriod = rows.filter(
      (d) =>
        !d.won_at &&
        !d.lost_at &&
        d.created_at >= fromIso &&
        d.created_at <= toIso,
    );

    const revenue = wonInPeriod.reduce(
      (acc, d) => acc + Number(d.value ?? 0),
      0,
    );
    const dealsWon = wonInPeriod.length;
    const dealsLost = lostInPeriod.length;
    const dealsOpen = openInPeriod.length;
    const totalClosed = dealsWon + dealsLost;
    const avgTicket = dealsWon > 0 ? revenue / dealsWon : 0;
    const conversionRate =
      totalClosed > 0 ? Math.round((dealsWon / totalClosed) * 1000) / 10 : 0;

    // Ciclo médio (created → won) em dias
    const cycles = wonInPeriod
      .map((d) => {
        const created = new Date(d.created_at).getTime();
        const won = new Date(d.won_at!).getTime();
        return (won - created) / 86_400_000;
      })
      .filter((d) => d >= 0);
    const avgCycleDays =
      cycles.length > 0
        ? Math.round((cycles.reduce((a, b) => a + b, 0) / cycles.length) * 10) / 10
        : null;

    // Série semanal
    const weekly = aggregateByWeek(rows, fromIso, toIso);

    // Receita cumulativa por dia (só won)
    const cumulative = computeCumulativeRevenue(wonInPeriod, fromIso, toIso);

    // Top 5 motivos de perda
    const reasonsCount = new Map<string, number>();
    for (const d of lostInPeriod) {
      const r = (d.lost_reason ?? 'Sem motivo informado').trim();
      reasonsCount.set(r, (reasonsCount.get(r) ?? 0) + 1);
    }
    const lostReasons = Array.from(reasonsCount.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      period: { from: fromIso, to: toIso },
      totals: {
        revenue: round2(revenue),
        deals_won: dealsWon,
        deals_lost: dealsLost,
        deals_open: dealsOpen,
        avg_ticket: round2(avgTicket),
        conversion_rate: conversionRate,
        avg_cycle_days: avgCycleDays,
      },
      weekly_series: weekly,
      revenue_cumulative: cumulative,
      lost_reasons: lostReasons,
    };
  }

  // ────────────────────────────────────────────
  // AGENTS
  // ────────────────────────────────────────────

  async getAgentReport(orgId: string, period: PeriodInput): Promise<AgentReport> {
    const { fromIso, toIso, fromDate, toDate } = resolvePeriod(period);

    // 1. Busca todos os membros ativos
    const { data: members, error: membersErr } = await this.supabase.adminClient
      .from('org_members')
      .select('user_id, display_name, avatar_url, status')
      .eq('org_id', orgId)
      .neq('status', 'suspended');

    if (membersErr) throw new InternalServerErrorException(membersErr.message);

    // 2. Agrega agent_performance no período
    const { data: perf } = await this.supabase.adminClient
      .from('agent_performance')
      .select(
        'user_id, avg_first_response_ms, conversations_handled, deals_won, deals_lost, revenue, ai_feedback',
      )
      .eq('org_id', orgId)
      .gte('period_date', fromDate)
      .lte('period_date', toDate);

    const perfByUser = new Map<
      string,
      {
        conversations_handled: number;
        first_response_ms_sum: number;
        first_response_ms_count: number;
        deals_won: number;
        deals_lost: number;
        revenue: number;
        ai_score_sum: number;
        ai_score_count: number;
      }
    >();

    for (const row of (perf ?? []) as Array<{
      user_id: string;
      avg_first_response_ms: number | null;
      conversations_handled: number;
      deals_won: number;
      deals_lost: number;
      revenue: number;
      ai_feedback: { score?: number } | null;
    }>) {
      const e = perfByUser.get(row.user_id) ?? {
        conversations_handled: 0,
        first_response_ms_sum: 0,
        first_response_ms_count: 0,
        deals_won: 0,
        deals_lost: 0,
        revenue: 0,
        ai_score_sum: 0,
        ai_score_count: 0,
      };
      e.conversations_handled += row.conversations_handled ?? 0;
      e.deals_won += row.deals_won ?? 0;
      e.deals_lost += row.deals_lost ?? 0;
      e.revenue += Number(row.revenue ?? 0);
      if (row.avg_first_response_ms !== null) {
        e.first_response_ms_sum += row.avg_first_response_ms;
        e.first_response_ms_count += 1;
      }
      const aiScore = row.ai_feedback?.score;
      if (typeof aiScore === 'number') {
        e.ai_score_sum += aiScore;
        e.ai_score_count += 1;
      }
      perfByUser.set(row.user_id, e);
    }

    // 3. Tarefas concluídas no período
    const { data: tasksData } = await this.supabase.adminClient
      .from('tasks')
      .select('assigned_to')
      .eq('org_id', orgId)
      .eq('status', 'completed')
      .gte('completed_at', fromIso)
      .lte('completed_at', toIso);

    const tasksByUser = new Map<string, number>();
    for (const t of (tasksData ?? []) as Array<{ assigned_to: string }>) {
      tasksByUser.set(t.assigned_to, (tasksByUser.get(t.assigned_to) ?? 0) + 1);
    }

    const agents = ((members ?? []) as Array<{
      user_id: string;
      display_name: string | null;
      avatar_url: string | null;
    }>).map((m) => {
      const p = perfByUser.get(m.user_id);
      return {
        user_id: m.user_id,
        display_name: m.display_name,
        avatar_url: m.avatar_url,
        conversations_handled: p?.conversations_handled ?? 0,
        avg_first_response_ms:
          p && p.first_response_ms_count > 0
            ? Math.round(p.first_response_ms_sum / p.first_response_ms_count)
            : null,
        deals_won: p?.deals_won ?? 0,
        deals_lost: p?.deals_lost ?? 0,
        revenue: round2(p?.revenue ?? 0),
        tasks_completed: tasksByUser.get(m.user_id) ?? 0,
        ai_score:
          p && p.ai_score_count > 0
            ? Math.round(p.ai_score_sum / p.ai_score_count)
            : null,
      };
    });

    // Ordena por revenue desc
    agents.sort((a, b) => b.revenue - a.revenue);

    return {
      period: { from: fromIso, to: toIso },
      agents,
    };
  }

  // ────────────────────────────────────────────
  // CHANNELS
  // ────────────────────────────────────────────

  async getChannelReport(orgId: string, period: PeriodInput): Promise<ChannelReport> {
    const { fromIso, toIso } = resolvePeriod(period);

    const { data: convs, error: convsErr } = await this.supabase.adminClient
      .from('conversations')
      .select('id, contact_id, channel_type, created_at')
      .eq('org_id', orgId)
      .gte('created_at', fromIso)
      .lte('created_at', toIso);

    if (convsErr) throw new InternalServerErrorException(convsErr.message);

    const rows = (convs ?? []) as Array<{
      id: string;
      contact_id: string | null;
      channel_type: string;
    }>;

    // Conta deals criados no período (lead = conversa que virou deal)
    const contactIds = Array.from(
      new Set(rows.map((r) => r.contact_id).filter((id): id is string => !!id)),
    );

    const dealsByContact = new Map<string, number>();
    if (contactIds.length > 0) {
      const { data: deals } = await this.supabase.adminClient
        .from('deals')
        .select('contact_id')
        .eq('org_id', orgId)
        .in('contact_id', contactIds)
        .gte('created_at', fromIso)
        .lte('created_at', toIso);

      for (const d of (deals ?? []) as Array<{ contact_id: string }>) {
        dealsByContact.set(d.contact_id, (dealsByContact.get(d.contact_id) ?? 0) + 1);
      }
    }

    // Agrupa por canal
    const byChannel = new Map<string, { conversations: number; leads: number }>();
    for (const c of rows) {
      const e = byChannel.get(c.channel_type) ?? { conversations: 0, leads: 0 };
      e.conversations += 1;
      if (c.contact_id && (dealsByContact.get(c.contact_id) ?? 0) > 0) {
        e.leads += 1;
      }
      byChannel.set(c.channel_type, e);
    }

    const channels = Array.from(byChannel.entries())
      .map(([channel_type, v]) => ({
        channel_type,
        conversations: v.conversations,
        leads: v.leads,
        conversion_rate:
          v.conversations > 0
            ? Math.round((v.leads / v.conversations) * 1000) / 10
            : 0,
      }))
      .sort((a, b) => b.conversations - a.conversations);

    return {
      period: { from: fromIso, to: toIso },
      channels,
      total_conversations: rows.length,
    };
  }

  // ────────────────────────────────────────────
  // FUNNEL
  // ────────────────────────────────────────────

  async getFunnelReport(
    orgId: string,
    pipelineId: string,
    period: PeriodInput,
  ): Promise<FunnelReport> {
    const { fromIso, toIso } = resolvePeriod(period);

    const [pipelineResp, stagesResp, dealsResp] = await Promise.all([
      this.supabase.adminClient
        .from('pipelines')
        .select('id, name')
        .eq('org_id', orgId)
        .eq('id', pipelineId)
        .maybeSingle(),
      this.supabase.adminClient
        .from('pipeline_stages')
        .select('id, name, color, position, is_won, is_lost, probability')
        .eq('pipeline_id', pipelineId)
        .order('position', { ascending: true }),
      this.supabase.adminClient
        .from('deals')
        .select(
          'id, stage_id, value, created_at, won_at, lost_at, stage_entered_at',
        )
        .eq('org_id', orgId)
        .eq('pipeline_id', pipelineId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso),
    ]);

    const pipeline = pipelineResp.data as { id: string; name: string } | null;
    if (!pipeline) {
      throw new InternalServerErrorException(`Pipeline ${pipelineId} não encontrado`);
    }

    const stages = (stagesResp.data ?? []) as Array<{
      id: string;
      name: string;
      color: string;
      position: number;
      is_won: boolean;
      is_lost: boolean;
      probability: number;
    }>;

    const deals = (dealsResp.data ?? []) as Array<{
      id: string;
      stage_id: string;
      value: number;
      created_at: string;
      won_at: string | null;
      lost_at: string | null;
      stage_entered_at: string;
    }>;

    // Para cada stage: count, total_value, avg time in stage (current snapshot)
    const stagesOut = stages.map((s, idx) => {
      const stageDeals = deals.filter((d) => d.stage_id === s.id);
      const dealsCount = stageDeals.length;
      const totalValue = stageDeals.reduce(
        (acc, d) => acc + Number(d.value ?? 0),
        0,
      );

      const hoursInStage = stageDeals
        .map(
          (d) =>
            (Date.now() - new Date(d.stage_entered_at).getTime()) /
            (60 * 60 * 1000),
        )
        .filter((h) => h >= 0);
      const avgTimeHours =
        hoursInStage.length > 0
          ? Math.round(
              (hoursInStage.reduce((a, b) => a + b, 0) / hoursInStage.length) *
                10,
            ) / 10
          : null;

      // Conversion rate stage→stage:
      // = (deals que estão NESSE stage ou em stages posteriores) / (deals que passaram POR esse stage)
      // Heurística simples: count(stages com position >= idx) / count(total que entrou no funil)
      // Para simplicidade aqui, calculamos como prev_count > 0 ? curr/prev : null
      const totalEnteredFunnel = deals.length;
      let conversionRate: number | null = null;
      let dropOffRate: number | null = null;

      if (idx > 0) {
        const prevStageId = stages[idx - 1]?.id;
        const prevDealsCount = prevStageId
          ? deals.filter((d) => d.stage_id === prevStageId).length
          : 0;
        if (prevDealsCount > 0) {
          conversionRate = Math.round((dealsCount / prevDealsCount) * 1000) / 10;
          dropOffRate = Math.round(((prevDealsCount - dealsCount) / prevDealsCount) * 1000) / 10;
        }
      } else if (idx === 0 && totalEnteredFunnel > 0) {
        conversionRate = 100;
        dropOffRate = 0;
      }

      return {
        id: s.id,
        name: s.name,
        color: s.color,
        position: s.position,
        is_won: s.is_won,
        is_lost: s.is_lost,
        deals_count: dealsCount,
        total_value: round2(totalValue),
        avg_time_in_stage_hours: avgTimeHours,
        conversion_rate: conversionRate,
        drop_off_rate: dropOffRate,
      };
    });

    // Bottleneck: maior drop_off_rate entre stages normais (não won/lost)
    const candidates = stagesOut.filter(
      (s) => !s.is_won && !s.is_lost && s.drop_off_rate !== null,
    );
    const bottleneck = candidates.reduce<typeof candidates[number] | null>(
      (best, s) => (best === null || (s.drop_off_rate ?? 0) > (best.drop_off_rate ?? 0) ? s : best),
      null,
    );

    return {
      period: { from: fromIso, to: toIso },
      pipeline,
      stages: stagesOut,
      bottleneck_stage_id: bottleneck?.id ?? null,
    };
  }

  // ────────────────────────────────────────────
  // INTERPRET (IA)
  // ────────────────────────────────────────────

  async interpretReport(
    orgId: string,
    userId: string,
    reportType: ReportType,
    data: Record<string, unknown>,
  ): Promise<InterpretResult> {
    const userPrompt = buildInterpretPrompt(reportType, data);

    const { data: result } = await this.anthropic.complete<InterpretResult>({
      interaction_type: 'diagnose',
      org_id: orgId,
      system: INTERPRET_SYSTEM_PROMPT,
      user: userPrompt,
      schema: INTERPRET_SCHEMA,
      max_tokens: 1024,
      context: { user_id: userId },
    });

    return {
      summary: result.summary?.trim() ?? '',
      insights: Array.isArray(result.insights)
        ? result.insights.filter((s) => typeof s === 'string')
        : [],
      recommendations: Array.isArray(result.recommendations)
        ? result.recommendations.filter((s) => typeof s === 'string')
        : [],
    };
  }
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

interface PeriodInput {
  from?: string;
  to?: string;
}

function resolvePeriod(p: PeriodInput): {
  fromIso: string;
  toIso: string;
  fromDate: string;
  toDate: string;
} {
  // Default: últimos 30 dias
  const now = new Date();
  const to = p.to ? new Date(p.to) : now;
  const from = p.from ? new Date(p.from) : new Date(to.getTime() - 30 * 86_400_000);

  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    fromDate: from.toISOString().slice(0, 10),
    toDate: to.toISOString().slice(0, 10),
  };
}

function aggregateByWeek(
  deals: Array<{
    won_at: string | null;
    lost_at: string | null;
    value: number;
  }>,
  fromIso: string,
  toIso: string,
): SalesReport['weekly_series'] {
  const buckets = new Map<
    string,
    { won: number; lost: number; revenue: number }
  >();

  const fromMs = new Date(fromIso).getTime();
  const toMs = new Date(toIso).getTime();

  function bucketKey(d: Date): string {
    // Início da semana (segunda-feira)
    const day = d.getUTCDay(); // 0..6 (sun..sat)
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(d);
    monday.setUTCDate(d.getUTCDate() - diff);
    monday.setUTCHours(0, 0, 0, 0);
    return monday.toISOString().slice(0, 10);
  }

  for (const d of deals) {
    if (d.won_at) {
      const t = new Date(d.won_at).getTime();
      if (t >= fromMs && t <= toMs) {
        const k = bucketKey(new Date(d.won_at));
        const e = buckets.get(k) ?? { won: 0, lost: 0, revenue: 0 };
        e.won += 1;
        e.revenue += Number(d.value ?? 0);
        buckets.set(k, e);
      }
    }
    if (d.lost_at) {
      const t = new Date(d.lost_at).getTime();
      if (t >= fromMs && t <= toMs) {
        const k = bucketKey(new Date(d.lost_at));
        const e = buckets.get(k) ?? { won: 0, lost: 0, revenue: 0 };
        e.lost += 1;
        buckets.set(k, e);
      }
    }
  }

  return Array.from(buckets.entries())
    .map(([week_start, v]) => ({
      week_start,
      won: v.won,
      lost: v.lost,
      revenue: round2(v.revenue),
    }))
    .sort((a, b) => a.week_start.localeCompare(b.week_start));
}

function computeCumulativeRevenue(
  wonDeals: Array<{ won_at: string | null; value: number }>,
  fromIso: string,
  toIso: string,
): Array<{ date: string; revenue: number }> {
  // Agrupa por dia
  const byDay = new Map<string, number>();
  for (const d of wonDeals) {
    if (!d.won_at) continue;
    const day = d.won_at.slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + Number(d.value ?? 0));
  }

  // Gera array dia-a-dia entre from e to com cumulative
  const fromDate = new Date(fromIso);
  const toDate = new Date(toIso);
  const out: Array<{ date: string; revenue: number }> = [];
  let cum = 0;

  for (
    let d = new Date(fromDate);
    d <= toDate;
    d.setUTCDate(d.getUTCDate() + 1)
  ) {
    const key = d.toISOString().slice(0, 10);
    cum += byDay.get(key) ?? 0;
    out.push({ date: key, revenue: round2(cum) });
  }

  return out;
}

function buildInterpretPrompt(
  reportType: ReportType,
  data: Record<string, unknown>,
): string {
  const lines: string[] = [];
  lines.push(`Tipo de relatório: ${reportType}`);
  lines.push('');
  lines.push('Dados do relatório (JSON):');
  lines.push(JSON.stringify(data, null, 2).slice(0, 12_000));
  lines.push('');
  lines.push(
    'Gere o JSON com summary, insights e recommendations conforme as diretrizes do system prompt.',
  );
  return lines.join('\n');
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
