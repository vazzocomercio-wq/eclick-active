import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { LockService } from '../../common/lock/lock.service';
import { AutomationBridgeService } from './automation-bridge.service';

const RESUME_INTERVAL_MS = 5 * 60 * 1000; // 5min
const STARTUP_DELAY_MS = 45 * 1000; // 45s — dá tempo do app subir antes de varrer
// TTL do lock < intervalo pra nunca ficar preso além de uma janela.
const RESUME_LOCK_TTL_SECONDS = 240;

/**
 * Scheduler leve que reprocessa execuções de broadcast/cart_recovery que
 * ficaram pendentes ou órfãs (worker morto no meio do envio). Sobrevive a
 * restart: um job de background interrompido deixa linhas 'pending'/'processing'
 * em active.automation_executions, e esta varredura as retoma.
 *
 * Padrão idêntico ao SacSchedulerService: setInterval + lock distribuído
 * (só uma instância roda por vez). A dedup real por execução é o claim atômico
 * em AutomationBridgeService.resumePendingExecutions.
 *
 * Desliga com AUTOMATION_RESUME_DISABLED=true.
 */
@Injectable()
export class AutomationResumeScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(AutomationResumeScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly bridge: AutomationBridgeService,
    private readonly lock: LockService,
  ) {}

  onModuleInit(): void {
    if (process.env.AUTOMATION_RESUME_DISABLED === 'true') {
      this.log.warn(
        'AUTOMATION_RESUME_DISABLED=true — retomada de broadcast/cart não vai rodar',
      );
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.runResume();
      this.timer = setInterval(() => void this.runResume(), RESUME_INTERVAL_MS);
    }, STARTUP_DELAY_MS);

    this.log.log(
      `Automation resume scheduler armado — varre a cada ${RESUME_INTERVAL_MS / 1000}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async runResume(): Promise<void> {
    const ran = await this.lock.withLock(
      'automation:resume',
      RESUME_LOCK_TTL_SECONDS,
      async () => {
        try {
          const stats = await this.bridge.resumePendingExecutions();
          if (stats.scanned > 0) {
            this.log.log(
              `resume: scanned=${stats.scanned} resent=${stats.resent} skipped=${stats.skipped} errors=${stats.errors}`,
            );
          }
        } catch (err) {
          this.log.warn(
            `resumePendingExecutions falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    );
    if (ran === null) {
      this.log.debug('resume pulado — outra instância detém o lock');
    }
  }
}
