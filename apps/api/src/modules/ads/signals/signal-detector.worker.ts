import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SignalDetectorService } from './signal-detector.service';

const TICK_INTERVAL_MS = 15 * 60 * 1000; // 15min
const BOOT_DELAY_MS = 7 * 60 * 1000; // 7min — depois do AdsSyncWorker (5min)

/**
 * Worker que tica a cada 15min, executando as 3 camadas do
 * SignalDetector pra cada org com integração ativa. Best-effort:
 * falha em uma org não impede o ciclo das outras.
 *
 * Pra desabilitar em dev: `DISABLE_SIGNAL_DETECTOR_WORKER=true`.
 */
@Injectable()
export class SignalDetectorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SignalDetectorWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly detector: SignalDetectorService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_SIGNAL_DETECTOR_WORKER === 'true') {
      this.logger.warn('Worker do SignalDetector desabilitado via env');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error(
          `tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_INTERVAL_MS);
    setTimeout(() => void this.tick().catch(() => {}), BOOT_DELAY_MS);
    this.logger.log(`Worker iniciado — ciclo de ${TICK_INTERVAL_MS / 60_000}min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const orgIds = await this.detector.listOrgsWithActiveIntegrations();
      if (orgIds.length === 0) return;
      this.logger.log(`Tick — ${orgIds.length} org(s) com integração ativa`);

      for (const orgId of orgIds) {
        try {
          const result = await this.detector.runForOrg(orgId);
          if (result.total > 0) {
            this.logger.log(
              `org=${orgId} signals=${result.total} (L1=${result.layer1} L2=${result.layer2} L3=${result.layer3}) took=${result.duration_ms}ms`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `org=${orgId} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
