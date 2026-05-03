import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { EventsGateway } from '../../gateways/events.gateway';

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15 min

/**
 * Worker que roda a cada 15min e:
 *   1. Envia lembrete 24h antes do appointment (via WebSocket pra UI mostrar
 *      notificação — em produção plugar ChannelDispatcher pra mandar WhatsApp)
 *   2. Envia lembrete 1h antes
 *   3. Detecta no-show (start_time + 30min sem confirmação) → marca status,
 *      cria task de recontato
 *
 * MVP: emite eventos via Socket.IO. A integração com ChannelDispatcher pra
 * WhatsApp/email fica pra próximo bloco.
 */
@Injectable()
export class AppointmentReminderWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AppointmentReminderWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly appointments: AppointmentsService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_APPOINTMENT_WORKER === 'true') {
      this.logger.warn('Worker de lembretes desabilitado via env');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error(
          `tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_INTERVAL_MS);
    // Roda 1ª vez 30s após o boot pra não competir com startup
    setTimeout(() => void this.tick().catch(() => {}), 30_000);
    this.logger.log(`Worker iniciado — ciclo de ${TICK_INTERVAL_MS / 60_000}min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const due = await this.appointments.findRemindersDue();

    for (const appt of due.twentyFourH) {
      this.events.emitToOrg(appt.org_id, 'appointment:reminder-24h', {
        appointment_id: appt.id,
        contact_id: appt.contact_id,
        contact_name: appt.contact?.name ?? null,
        agent_id: appt.assigned_to,
        title: appt.title,
        start_time: appt.start_time,
      });
      await this.appointments.markReminderSent(appt.id, '24h');
    }

    for (const appt of due.oneH) {
      this.events.emitToOrg(appt.org_id, 'appointment:reminder-1h', {
        appointment_id: appt.id,
        contact_id: appt.contact_id,
        contact_name: appt.contact?.name ?? null,
        agent_id: appt.assigned_to,
        title: appt.title,
        start_time: appt.start_time,
      });
      await this.appointments.markReminderSent(appt.id, '1h');
    }

    for (const appt of due.noShow) {
      try {
        await this.appointments.markNoShow(appt.org_id, appt.id);
        this.events.emitToOrg(appt.org_id, 'appointment:no-show', {
          appointment_id: appt.id,
          contact_id: appt.contact_id,
          agent_id: appt.assigned_to,
          title: appt.title,
        });
      } catch (err) {
        this.logger.warn(
          `markNoShow ${appt.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (due.twentyFourH.length || due.oneH.length || due.noShow.length) {
      this.logger.log(
        `Tick — 24h:${due.twentyFourH.length}, 1h:${due.oneH.length}, no-show:${due.noShow.length}`,
      );
    }
  }
}
