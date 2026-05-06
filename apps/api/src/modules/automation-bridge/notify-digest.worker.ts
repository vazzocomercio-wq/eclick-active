import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { AutomationBridgeService } from './automation-bridge.service';

/**
 * Worker do digest de notificações ao lojista.
 *
 * Ticks:
 *   - Medium digest: a cada 4h
 *   - Low/opportunity digest: 1×/dia (fixo às 9h horário do servidor)
 *
 * Padrão Active: setInterval + OnModuleInit/OnModuleDestroy. Sem Bull/
 * BullMQ.
 *
 * Kill-switch: env `DISABLE_AUTOMATION_DIGEST_WORKER=true` desliga.
 */
const MEDIUM_TICK_MS = 4 * 60 * 60 * 1000; // 4h
const LOW_CHECK_MS = 30 * 60 * 1000; // checa a cada 30min se já é hora do daily
const STARTUP_DELAY_MS = 60 * 1000; // espera 1min após boot
const DAILY_DIGEST_HOUR_LOCAL = 9; // 9h horário do servidor

@Injectable()
export class NotifyDigestWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(NotifyDigestWorker.name);
  private mediumTimer: NodeJS.Timeout | null = null;
  private lowTimer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  /** Marca quando rodou o daily digest hoje pra não rodar 2x. */
  private lastDailyRun: string | null = null;

  constructor(private readonly bridge: AutomationBridgeService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_AUTOMATION_DIGEST_WORKER === 'true') {
      this.log.warn('NotifyDigestWorker desligado por env');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      this.mediumTimer = setInterval(
        () => void this.runMedium(),
        MEDIUM_TICK_MS,
      );
      this.lowTimer = setInterval(
        () => void this.maybeRunDaily(),
        LOW_CHECK_MS,
      );
      // Roda imediatamente no startup (não espera 4h pra primeiro tick)
      void this.runMedium();
      void this.maybeRunDaily();
    }, STARTUP_DELAY_MS);
    this.log.log(
      `NotifyDigestWorker armado — medium 4h, daily 9h locale`,
    );
  }

  onModuleDestroy(): void {
    if (this.mediumTimer) clearInterval(this.mediumTimer);
    if (this.lowTimer) clearInterval(this.lowTimer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async runMedium(): Promise<void> {
    try {
      const stats = await this.bridge.runDigest('medium');
      if (stats.orgs > 0) {
        this.log.log(
          `medium digest: ${stats.orgs} orgs, ${stats.sent} sent, ${stats.failed} failed`,
        );
      }
    } catch (err) {
      this.log.warn(`medium digest falhou: ${String(err)}`);
    }
  }

  private async maybeRunDaily(): Promise<void> {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    // Só roda se já passou da hora-alvo E não rodou hoje ainda
    if (now.getHours() < DAILY_DIGEST_HOUR_LOCAL) return;
    if (this.lastDailyRun === today) return;

    this.lastDailyRun = today;
    try {
      const lowStats = await this.bridge.runDigest('low');
      const oppStats = await this.bridge.runDigest('opportunity');
      this.log.log(
        `daily digest: low ${lowStats.sent}/${lowStats.failed}, opp ${oppStats.sent}/${oppStats.failed}`,
      );
    } catch (err) {
      this.log.warn(`daily digest falhou: ${String(err)}`);
    }
  }
}
