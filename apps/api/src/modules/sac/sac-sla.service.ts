import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import type {
  SacSlaRule,
  SacPriority,
  SacCategory,
} from './sac.types';
import type { CreateSlaRuleDto, UpdateSlaRuleDto } from './dto/sla-rule.dto';

interface MatchInput {
  priority?: SacPriority;
  category?: SacCategory;
  channel_type?: string | null;
}

interface DeadlineResult {
  first_response_at: Date;
  resolution_at: Date;
  matched_rule_id: string | null;
}

const FALLBACK_FIRST_RESPONSE_MIN = 60;
const FALLBACK_RESOLUTION_MIN = 480;

/**
 * Service de SLA: cálculo de deadlines + verificação de breach.
 *
 * Estratégia de match:
 *   1. Busca todas as rules ativas da org
 *   2. Filtra as que casam (priority/category/channel = NULL conta como wildcard)
 *   3. Pega a com `specificity_score` mais alta (priority=4, category=2, channel=1)
 *   4. Se nenhuma casar, usa fallback hardcoded (60min/480min)
 *
 * `business_hours_only` é honrado de forma simplificada: se true e estamos
 * fora do business hours, adiciona 12h ao deadline (proxy razoável). Pra
 * cálculo rigoroso baseado em `business_hours` da org, evoluir depois.
 */
@Injectable()
export class SacSlaService {
  private readonly log = new Logger(SacSlaService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Calcula deadlines de SLA pra um ticket recém-criado. */
  async calculateDeadline(
    orgId: string,
    input: MatchInput,
    baseTime: Date = new Date(),
  ): Promise<DeadlineResult> {
    try {
      let q = this.supabase.adminClient
        .from('sac_sla_rules')
        .select('*')
        .eq('org_id', orgId)
        .eq('is_active', true)
        .order('specificity_score', { ascending: false })
        .limit(20);
      const { data, error } = await q;
      if (error) throw error;
      const rules = (data ?? []) as SacSlaRule[];

      const matched = rules.find((r) => this.matches(r, input));
      if (matched) {
        return {
          first_response_at: this.addMinutes(
            baseTime,
            matched.first_response_minutes,
            matched.business_hours_only,
          ),
          resolution_at: this.addMinutes(
            baseTime,
            matched.resolution_minutes,
            matched.business_hours_only,
          ),
          matched_rule_id: matched.id,
        };
      }
    } catch (err) {
      this.log.warn(`calculateDeadline falhou (usando fallback): ${String(err)}`);
    }
    return {
      first_response_at: this.addMinutes(baseTime, FALLBACK_FIRST_RESPONSE_MIN, true),
      resolution_at: this.addMinutes(baseTime, FALLBACK_RESOLUTION_MIN, true),
      matched_rule_id: null,
    };
  }

  private matches(rule: SacSlaRule, input: MatchInput): boolean {
    if (rule.priority && rule.priority !== input.priority) return false;
    if (rule.category && rule.category !== input.category) return false;
    if (
      rule.channel_type &&
      rule.channel_type !== (input.channel_type ?? null)
    ) {
      return false;
    }
    return true;
  }

  // Horário comercial padrão (BRT, UTC-3): seg–sex, 8h–19h.
  private static readonly BRT_OFFSET_MIN = -3 * 60;
  private static readonly BIZ_START_HOUR = 8;
  private static readonly BIZ_END_HOUR = 19;

  /**
   * Soma `minutes` a `base`. Se `businessHoursOnly`, consome o orçamento de
   * minutos apenas dentro do horário comercial (seg–sex 8–19h BRT), pulando
   * noites e fins de semana — em vez da heurística antiga de +12h/+24h fixos
   * (que gerava breaches falsos no fim de semana).
   */
  private addMinutes(base: Date, minutes: number, businessHoursOnly: boolean): Date {
    if (!businessHoursOnly) {
      return new Date(base.getTime() + minutes * 60_000);
    }
    const OFF = SacSlaService.BRT_OFFSET_MIN;
    const START = SacSlaService.BIZ_START_HOUR;
    const END = SacSlaService.BIZ_END_HOUR;

    let cursorUtc = base.getTime();
    let remaining = minutes;
    let guard = 0; // trava de segurança contra loop infinito

    while (remaining > 0 && guard < 5000) {
      guard += 1;
      // Instante atual em "relógio BRT" (deslocado pra ler hora/dia local).
      const brt = new Date(cursorUtc + OFF * 60_000);
      const day = brt.getUTCDay(); // 0=dom … 6=sáb
      const hour = brt.getUTCHours();
      const min = brt.getUTCMinutes();

      const isWeekend = day === 0 || day === 6;
      const beforeOpen = hour < START;
      const afterClose = hour >= END;

      if (isWeekend || beforeOpen || afterClose) {
        // Pula pro próximo início de expediente (8:00 BRT do próximo dia útil).
        const next = new Date(brt.getTime());
        if (afterClose || isWeekend) {
          next.setUTCDate(next.getUTCDate() + 1);
        }
        next.setUTCHours(START, 0, 0, 0);
        // Se caiu em fim de semana, avança até segunda.
        while (next.getUTCDay() === 0 || next.getUTCDay() === 6) {
          next.setUTCDate(next.getUTCDate() + 1);
        }
        cursorUtc = next.getTime() - OFF * 60_000; // volta pra UTC
        continue;
      }

      // Minutos restantes até o fim do expediente de hoje.
      const minsToClose = (END - hour) * 60 - min;
      const consume = Math.min(remaining, minsToClose);
      cursorUtc += consume * 60_000;
      remaining -= consume;
    }
    return new Date(cursorUtc);
  }

  /** Detecta breach via RPC (usado pelo worker). */
  async checkBreaches(): Promise<Array<{ ticket_id: string; org_id: string }>> {
    try {
      const { data, error } = await this.supabase.adminClient.rpc(
        'sac_check_sla_breaches',
      );
      if (error) throw error;
      return (data ?? []) as Array<{ ticket_id: string; org_id: string }>;
    } catch (err) {
      this.log.warn(`checkBreaches falhou: ${String(err)}`);
      return [];
    }
  }

  /** SLA stats agregadas pra dashboard/relatórios. */
  async getStats(
    orgId: string,
    sinceDays = 30,
  ): Promise<{
    fulfilled: number;
    breached: number;
    avg_first_response_minutes: number;
    avg_resolution_minutes: number;
    fulfilled_pct: number;
  }> {
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString();
    try {
      const { data, error } = await this.supabase.adminClient
        .from('sac_tickets')
        .select(
          'sla_breached, sla_first_response_at, sla_resolved_at, created_at, resolved_at, first_response_at',
        )
        .eq('org_id', orgId)
        .gte('created_at', since)
        .limit(2000);
      if (error) throw error;

      const rows = (data ?? []) as Array<{
        sla_breached: boolean;
        created_at: string;
        first_response_at: string | null;
        resolved_at: string | null;
      }>;

      // "Cumprido" = ticket com desfecho definitivo (resolvido) DENTRO do prazo.
      // Antes contava também tickets abertos e no prazo, inflando o %.
      const resolved = rows.filter((r) => r.resolved_at);
      const breached = rows.filter((r) => r.sla_breached).length;
      const fulfilled = resolved.filter((r) => !r.sla_breached).length;
      // Denominador: tickets com desfecho conhecido (cumpridos + violados).
      const decided = fulfilled + breached;

      const firstResponses = rows
        .filter((r) => r.first_response_at)
        .map(
          (r) =>
            (new Date(r.first_response_at as string).getTime() -
              new Date(r.created_at).getTime()) /
            60_000,
        );
      const resolutions = resolved.map(
        (r) =>
          (new Date(r.resolved_at as string).getTime() -
            new Date(r.created_at).getTime()) /
          60_000,
      );

      const avg = (xs: number[]) =>
        xs.length === 0 ? 0 : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

      return {
        fulfilled,
        breached,
        avg_first_response_minutes: avg(firstResponses),
        avg_resolution_minutes: avg(resolutions),
        fulfilled_pct:
          decided === 0 ? 0 : Math.round((fulfilled / decided) * 100),
      };
    } catch (err) {
      this.log.warn(`getStats falhou: ${String(err)}`);
      return {
        fulfilled: 0,
        breached: 0,
        avg_first_response_minutes: 0,
        avg_resolution_minutes: 0,
        fulfilled_pct: 0,
      };
    }
  }

  // ─── CRUD de regras ──────────────────────────────
  async listRules(orgId: string): Promise<SacSlaRule[]> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_sla_rules')
      .select('*')
      .eq('org_id', orgId)
      .order('specificity_score', { ascending: false });
    if (error) throw error;
    return (data ?? []) as SacSlaRule[];
  }

  async createRule(orgId: string, dto: CreateSlaRuleDto): Promise<SacSlaRule> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_sla_rules')
      .insert({ ...dto, org_id: orgId })
      .select('*')
      .single();
    if (error) throw error;
    return data as SacSlaRule;
  }

  async updateRule(
    orgId: string,
    id: string,
    dto: UpdateSlaRuleDto,
  ): Promise<SacSlaRule> {
    const { data, error } = await this.supabase.adminClient
      .from('sac_sla_rules')
      .update(dto)
      .eq('id', id)
      .eq('org_id', orgId)
      .select('*')
      .single();
    if (error) throw error;
    return data as SacSlaRule;
  }

  async deleteRule(orgId: string, id: string): Promise<void> {
    const { error } = await this.supabase.adminClient
      .from('sac_sla_rules')
      .delete()
      .eq('id', id)
      .eq('org_id', orgId);
    if (error) throw error;
  }
}
