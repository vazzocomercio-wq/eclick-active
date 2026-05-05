import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SacSlaService } from './sac-sla.service';
import { SacPreventiveService } from './sac-preventive.service';
import { EventsGateway } from '../../gateways/events.gateway';
import { SupabaseService } from '../../common/supabase/supabase.service';

const SLA_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5min
const PREVENTIVE_SCAN_INTERVAL_MS = 60 * 60 * 1000; // 1h
const STARTUP_DELAY_MS = 30 * 1000; // 30s — não roda no boot pra dar tempo do app subir

/**
 * Agenda jobs periódicos do SAC:
 *   - SLA breach detection (5min): chama RPC `sac_check_sla_breaches`,
 *     emite `sac:sla-breached` pra cada ticket detectado.
 *   - Preventive scan (1h): pra cada org com bridge SaaS ativo, busca
 *     pedidos atrasados e cria tickets preventivos.
 *
 * Usa setInterval simples — suficiente pra estes intervalos. Se virarem
 * jobs caros, migrar pra BullMQ ou pg_cron.
 */
@Injectable()
export class SacSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SacSchedulerService.name);
  private slaTimer: NodeJS.Timeout | null = null;
  private preventiveTimer: NodeJS.Timeout | null = null;
  private startupSlaTimeout: NodeJS.Timeout | null = null;
  private startupPreventiveTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly sla: SacSlaService,
    private readonly preventive: SacPreventiveService,
    private readonly events: EventsGateway,
    private readonly supabase: SupabaseService,
  ) {}

  onModuleInit(): void {
    if (process.env.SAC_SCHEDULER_DISABLED === 'true') {
      this.log.warn('SAC_SCHEDULER_DISABLED=true — scheduler não vai rodar');
      return;
    }
    // Atrasa startup pra não disputar com migrations / outros boots
    this.startupSlaTimeout = setTimeout(() => {
      void this.runSlaCheck();
      this.slaTimer = setInterval(
        () => void this.runSlaCheck(),
        SLA_CHECK_INTERVAL_MS,
      );
    }, STARTUP_DELAY_MS);

    this.startupPreventiveTimeout = setTimeout(() => {
      void this.runPreventive();
      this.preventiveTimer = setInterval(
        () => void this.runPreventive(),
        PREVENTIVE_SCAN_INTERVAL_MS,
      );
    }, STARTUP_DELAY_MS * 2);

    this.log.log(
      `SAC scheduler armado — SLA check ${SLA_CHECK_INTERVAL_MS / 1000}s, preventive ${PREVENTIVE_SCAN_INTERVAL_MS / 1000}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.slaTimer) clearInterval(this.slaTimer);
    if (this.preventiveTimer) clearInterval(this.preventiveTimer);
    if (this.startupSlaTimeout) clearTimeout(this.startupSlaTimeout);
    if (this.startupPreventiveTimeout) clearTimeout(this.startupPreventiveTimeout);
  }

  private async runSlaCheck(): Promise<void> {
    try {
      const breaches = await this.sla.checkBreaches();
      if (breaches.length === 0) return;

      // Pra cada breach, busca priority+number e emite evento pra org
      for (const b of breaches) {
        try {
          const { data } = await this.supabase.adminClient
            .from('sac_tickets')
            .select('priority, ticket_number')
            .eq('id', b.ticket_id)
            .eq('org_id', b.org_id)
            .maybeSingle();
          const t = data as
            | { priority?: string; ticket_number?: number }
            | null;
          this.events.emitToOrg(b.org_id, 'sac:sla-breached', {
            ticket_id: b.ticket_id,
            priority: t?.priority,
            ticket_number: t?.ticket_number,
          });
        } catch (err) {
          this.log.warn(`emit sla-breached falhou: ${String(err)}`);
        }
      }
      this.log.log(`SLA breach check: ${breaches.length} ticket(s) violados`);
    } catch (err) {
      this.log.warn(`runSlaCheck falhou: ${String(err)}`);
    }
  }

  private async runPreventive(): Promise<void> {
    try {
      await this.preventive.runScanForAllOrgs();
    } catch (err) {
      this.log.warn(`runPreventive falhou: ${String(err)}`);
    }
  }
}
