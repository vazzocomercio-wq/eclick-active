import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReEngagementService } from './re-engagement.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h

/**
 * Worker que roda de hora em hora pra cada org com re_engagement
 * habilitado. Best-effort — falhas em uma org não param outras.
 */
@Injectable()
export class ReEngagementWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReEngagementWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly service: ReEngagementService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_REENGAGEMENT_WORKER === 'true') {
      this.logger.warn('Worker de re-engagement desabilitado via env');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error(
          `tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_INTERVAL_MS);
    // 1ª rodada 2min após boot pra dar margem de inicialização
    setTimeout(() => void this.tick().catch(() => {}), 2 * 60 * 1000);
    this.logger.log(`Worker iniciado — ciclo de ${TICK_INTERVAL_MS / 60_000}min`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return; // evita overlap quando o ciclo demora
    this.inFlight = true;
    try {
      const orgIds = await this.service.listEnabledOrgs();
      if (orgIds.length === 0) return;
      this.logger.log(`Tick — ${orgIds.length} org(s) com re-engagement on`);

      for (const orgId of orgIds) {
        try {
          const result = await this.service.runForOrg(orgId);
          if (result.processed > 0) {
            this.logger.log(
              `org=${orgId} processed=${result.processed} sent=${result.sent} skipped=${result.skipped}`,
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
