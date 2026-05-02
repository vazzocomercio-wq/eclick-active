import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import type {
  BusinessHoursConfig,
  BusinessHoursDayConfig,
  WeekdayKey,
} from '@eclick-active/shared';
import { SupabaseService } from '../../common/supabase/supabase.service';

const WEEKDAY_KEYS: WeekdayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const DEFAULT_CONFIG: BusinessHoursConfig = {
  enabled: false,
  timezone: 'America/Sao_Paulo',
  schedule: {
    mon: { start: '08:00', end: '18:00', enabled: true },
    tue: { start: '08:00', end: '18:00', enabled: true },
    wed: { start: '08:00', end: '18:00', enabled: true },
    thu: { start: '08:00', end: '18:00', enabled: true },
    fri: { start: '08:00', end: '18:00', enabled: true },
    sat: { start: '09:00', end: '13:00', enabled: false },
    sun: { enabled: false },
  },
};

@Injectable()
export class BusinessHoursService {
  private readonly logger = new Logger(BusinessHoursService.name);

  constructor(private readonly supabase: SupabaseService) {}

  // ──────────────────────────────────────────────────────────
  // Get / update
  // ──────────────────────────────────────────────────────────

  async get(orgId: string): Promise<BusinessHoursConfig> {
    const { data, error } = await this.supabase.adminClient
      .from('organizations')
      .select('business_hours')
      .eq('id', orgId)
      .maybeSingle();
    if (error) throw new InternalServerErrorException(error.message);
    const cfg = (data?.business_hours as BusinessHoursConfig | null) ?? null;
    return cfg ?? DEFAULT_CONFIG;
  }

  async update(orgId: string, dto: Partial<BusinessHoursConfig>): Promise<BusinessHoursConfig> {
    const current = await this.get(orgId);
    const merged: BusinessHoursConfig = {
      enabled: dto.enabled ?? current.enabled,
      timezone: dto.timezone ?? current.timezone,
      schedule: { ...current.schedule, ...(dto.schedule ?? {}) },
    };

    const { error } = await this.supabase.adminClient
      .from('organizations')
      .update({ business_hours: merged })
      .eq('id', orgId);
    if (error) throw new InternalServerErrorException(error.message);
    return merged;
  }

  // ──────────────────────────────────────────────────────────
  // Logic — está dentro do horário comercial AGORA?
  // ──────────────────────────────────────────────────────────

  /**
   * Verifica se o horário atual está dentro da janela comercial.
   * Quando `enabled=false`, considera SEMPRE dentro (auto-respond não rola).
   */
  async isWithinBusinessHours(orgId: string): Promise<boolean> {
    const cfg = await this.get(orgId);
    if (!cfg.enabled) return true;
    return this.isWithinNow(cfg, new Date());
  }

  /**
   * Versão pura — útil pra testes e pro modo teste do agente.
   */
  isWithinNow(cfg: BusinessHoursConfig, now: Date): boolean {
    const local = this.toTzParts(now, cfg.timezone);
    const dayKey = WEEKDAY_KEYS[local.weekday];
    if (!dayKey) return false;
    const day = cfg.schedule[dayKey];
    if (!day || !day.enabled || !day.start || !day.end) return false;

    const startMin = parseHHMM(day.start);
    const endMin = parseHHMM(day.end);
    const nowMin = local.hour * 60 + local.minute;
    return nowMin >= startMin && nowMin < endMin;
  }

  /**
   * Próximo horário de abertura (Date em UTC). Útil pra UI de preview e
   * pra agendar tarefas de follow-up. Retorna null se nenhum dia tem janela.
   */
  nextOpenAt(cfg: BusinessHoursConfig, now: Date): Date | null {
    if (!cfg.enabled) return null;
    for (let dayOffset = 0; dayOffset < 14; dayOffset++) {
      const candidate = new Date(now.getTime() + dayOffset * 86_400_000);
      const local = this.toTzParts(candidate, cfg.timezone);
      const dayKey = WEEKDAY_KEYS[local.weekday];
      if (!dayKey) continue;
      const day = cfg.schedule[dayKey];
      if (!day || !day.enabled || !day.start) continue;

      const startMin = parseHHMM(day.start);
      const todayMin = local.hour * 60 + local.minute;

      if (dayOffset === 0 && todayMin >= startMin) {
        // Já passou hoje — pula
        continue;
      }

      // Constrói a data de abertura no timezone configurado
      const date = new Date(candidate);
      const startH = Math.floor(startMin / 60);
      const startM = startMin % 60;
      // Aproximação: setar hora local. Pode haver pequeno desvio em horário de
      // verão; aceitável pra preview de UI.
      date.setUTCHours(0, 0, 0, 0);
      const localToday = this.toTzParts(date, cfg.timezone);
      const tzOffsetHours = localToday.tzOffsetMinutes / 60;
      date.setUTCHours(startH - tzOffsetHours, startM, 0, 0);
      return date;
    }
    return null;
  }

  // ──────────────────────────────────────────────────────────
  // Helpers
  // ──────────────────────────────────────────────────────────

  /**
   * Quebra um Date no timezone informado em weekday/hour/minute
   * usando Intl.DateTimeFormat.formatToParts (sem libs).
   */
  private toTzParts(
    d: Date,
    tz: string,
  ): { weekday: number; hour: number; minute: number; tzOffsetMinutes: number } {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour12: false,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).formatToParts(d);

      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;

      const weekday = WEEKDAY_INDEX[map.weekday ?? ''] ?? 0;
      const hour = Number(map.hour ?? '0');
      const minute = Number(map.minute ?? '0');

      // Calcula offset entre UTC e tz (em minutos)
      const utcMs = Date.UTC(
        d.getUTCFullYear(),
        d.getUTCMonth(),
        d.getUTCDate(),
        d.getUTCHours(),
        d.getUTCMinutes(),
      );
      // Date no tz
      const tzMs = new Date(
        new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        })
          .formatToParts(d)
          .reduce<Record<string, string>>((acc, p) => {
            acc[p.type] = p.value;
            return acc;
          }, {}) as unknown as string,
      ).getTime();
      // Fallback simples — em prod usaria date-fns-tz
      const tzOffsetMinutes = Number.isFinite(tzMs)
        ? Math.round((tzMs - utcMs) / 60_000)
        : 0;

      return { weekday, hour, minute, tzOffsetMinutes };
    } catch (err) {
      this.logger.warn(
        `Timezone inválida "${tz}" — fallback UTC: ${err instanceof Error ? err.message : ''}`,
      );
      return {
        weekday: d.getUTCDay(),
        hour: d.getUTCHours(),
        minute: d.getUTCMinutes(),
        tzOffsetMinutes: 0,
      };
    }
  }
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function parseHHMM(s: string): number {
  const [h, m] = s.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export type { BusinessHoursConfig, BusinessHoursDayConfig };
