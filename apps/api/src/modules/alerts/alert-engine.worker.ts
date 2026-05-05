import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { getOrgTimezone } from '../../common/org-settings.helper';
import { AlertEngineService } from './alert-engine.service';
import { DeliveryMode } from './alert-routing.service';

const IMMEDIATE_TICK_MS = 5 * 60 * 1000; // 5min
const SLOT_TICK_MS = 60 * 60 * 1000; // 1h — checa se algum slot bateu
const BOOT_DELAY_MS = 9 * 60 * 1000; // 9min — depois de SignalDetectorWorker (7min)

const SLOT_HOURS: Record<Exclude<DeliveryMode, 'immediate'>, { hour: number; weekday?: number }> = {
  digest_8h: { hour: 8 },
  digest_14h: { hour: 14 },
  digest_18h: { hour: 18 },
  weekly: { hour: 8, weekday: 1 }, // segunda
};

/**
 * AlertEngineWorker — orquestra os 2 ciclos:
 *
 * 1. Imediate (5min): processSignals + dispatchPending pra cada org com
 *    manager active. Aceita atraso ≤5min entre signal detectado e
 *    msg WhatsApp na mão do gestor.
 *
 * 2. Slot (1h): a cada hora, checa o relógio LOCAL DA ORG (via tz). Se
 *    bate em horário de slot (8h/14h/18h ou seg 8h pra weekly), chama
 *    processDigestSlot. Anti-double-fire: cada delivery só é consolidada
 *    1x porque processDigestSlot marca os deferred como 'acked'.
 *
 * Pra desabilitar em dev: DISABLE_ALERT_ENGINE_WORKER=true.
 */
@Injectable()
export class AlertEngineWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AlertEngineWorker.name);
  private immediateTimer: NodeJS.Timeout | null = null;
  private slotTimer: NodeJS.Timeout | null = null;
  private inFlight = false;

  /** Tracking pra anti-double-fire de slot dentro da mesma hora local. */
  private firedSlotKey = new Set<string>();

  constructor(
    private readonly engine: AlertEngineService,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_ALERT_ENGINE_WORKER === 'true') {
      this.logger.warn('Worker do AlertEngine desabilitado via env');
      return;
    }
    this.immediateTimer = setInterval(() => {
      void this.tickImmediate().catch((err) => {
        this.logger.error(
          `tickImmediate failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, IMMEDIATE_TICK_MS);
    this.slotTimer = setInterval(() => {
      void this.tickSlot().catch((err) => {
        this.logger.error(
          `tickSlot failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, SLOT_TICK_MS);
    setTimeout(() => void this.tickImmediate().catch(() => {}), BOOT_DELAY_MS);
    this.logger.log(
      `Worker iniciado — immediate ${IMMEDIATE_TICK_MS / 60_000}min, slot ${SLOT_TICK_MS / 60_000}min`,
    );
  }

  onModuleDestroy(): void {
    if (this.immediateTimer) clearInterval(this.immediateTimer);
    if (this.slotTimer) clearInterval(this.slotTimer);
  }

  // ────────────────────────────────────────────
  // Tick: immediate
  // ────────────────────────────────────────────

  async tickImmediate(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const orgIds = await this.engine.listActiveOrgs();
      if (orgIds.length === 0) return;

      for (const orgId of orgIds) {
        try {
          const proc = await this.engine.processSignals(orgId);
          const dispatch = await this.engine.dispatchPending(orgId);
          if (proc.processed > 0 || dispatch.sent > 0 || dispatch.failed > 0) {
            this.logger.log(
              `org=${orgId} signals=${proc.processed} created=${proc.deliveries_created} sent=${dispatch.sent} failed=${dispatch.failed}`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `tickImmediate org=${orgId} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.inFlight = false;
    }
  }

  // ────────────────────────────────────────────
  // Tick: slot (8h/14h/18h/segunda 8h no tz da org)
  // ────────────────────────────────────────────

  async tickSlot(): Promise<void> {
    const orgIds = await this.engine.listActiveOrgs();
    if (orgIds.length === 0) return;

    for (const orgId of orgIds) {
      try {
        const tz = await getOrgTimezone(this.supabase.adminClient, orgId);
        const local = nowInTz(tz);
        const slotsDue = this.slotsDue(local);
        if (slotsDue.length === 0) continue;

        for (const slot of slotsDue) {
          const fireKey = `${orgId}:${slot}:${local.dateKey}:${local.hour}`;
          if (this.firedSlotKey.has(fireKey)) continue;
          this.firedSlotKey.add(fireKey);

          try {
            const r = await this.engine.processDigestSlot(orgId, slot);
            if (r.digests > 0) {
              this.logger.log(
                `org=${orgId} slot=${slot} digests=${r.digests}`,
              );
            }
          } catch (err) {
            this.logger.warn(
              `tickSlot org=${orgId} slot=${slot} falhou: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }
      } catch (err) {
        this.logger.warn(
          `tickSlot org=${orgId} crash: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Limpa fireKeys de outros dias (evita Set crescer infinitamente)
    if (this.firedSlotKey.size > 1000) {
      this.firedSlotKey.clear();
    }
  }

  /**
   * Retorna lista de slots que devem disparar AGORA (na hora local da org).
   * Tolerância: dispara se hour == slot.hour (1h de janela; tickSlot roda 1x/h).
   */
  private slotsDue(local: { hour: number; weekday: number }): DeliveryMode[] {
    const due: DeliveryMode[] = [];
    if (local.hour === SLOT_HOURS.digest_8h.hour) due.push('digest_8h');
    if (local.hour === SLOT_HOURS.digest_14h.hour) due.push('digest_14h');
    if (local.hour === SLOT_HOURS.digest_18h.hour) due.push('digest_18h');
    if (
      local.hour === SLOT_HOURS.weekly.hour &&
      local.weekday === SLOT_HOURS.weekly.weekday
    ) {
      due.push('weekly');
    }
    return due;
  }
}

// ─────────────────────────────────────────────────────────────

function nowInTz(tz: string): {
  hour: number;
  weekday: number; // 0=Sun, 1=Mon, ... 6=Sat
  dateKey: string;
} {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
  const hour = parseInt(get('hour'), 10);
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get('weekday')] ?? 0;
  const dateKey = `${get('year')}-${get('month')}-${get('day')}`;
  return { hour, weekday, dateKey };
}
