import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AdsOutcomeService } from './ads-outcome.service';

/**
 * Mede outcomes vencidos de hora em hora. Padrão dos workers do Active
 * (setInterval + boot delay). Disable via DISABLE_ADS_OUTCOME_WORKER=true
 * (setar em processos extra que rodem o AppModule).
 */
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const BOOT_DELAY_MS = 8 * 60 * 1000; // 8min

@Injectable()
export class AdsOutcomeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdsOutcomeWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimeout: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly outcomes: AdsOutcomeService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_ADS_OUTCOME_WORKER === 'true') {
      this.logger.warn('DISABLE_ADS_OUTCOME_WORKER=true — worker desligado');
      return;
    }
    this.bootTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, BOOT_DELAY_MS);
    this.logger.log(`AdsOutcomeWorker armado — tick a cada ${TICK_INTERVAL_MS / 60_000}min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimeout) clearTimeout(this.bootTimeout);
  }

  private async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      await this.outcomes.measureDue();
    } catch (err) {
      this.logger.warn(`tick falhou: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.inFlight = false;
    }
  }
}
