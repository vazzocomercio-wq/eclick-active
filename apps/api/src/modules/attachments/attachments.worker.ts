import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AttachmentsService } from './attachments.service';

const TICK_INTERVAL_MS = 30_000; // 30s
const BATCH_SIZE = 5;

/**
 * Worker que processa attachments pendentes (ai_processed_at IS NULL).
 * Chama Anthropic Vision pra gerar summary + extração estruturada.
 *
 * Best-effort: erros num attachment não param os outros do lote.
 */
@Injectable()
export class AttachmentsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AttachmentsWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly attachments: AttachmentsService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_ATTACHMENTS_WORKER === 'true') {
      this.logger.warn('Worker de attachments desabilitado via env');
      return;
    }
    this.timer = setInterval(() => {
      void this.tick().catch((err) => {
        this.logger.error(
          `tick failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }, TICK_INTERVAL_MS);
    setTimeout(() => void this.tick().catch(() => {}), 15_000);
    this.logger.log(`Worker iniciado — ciclo de ${TICK_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return; // evita overlap quando uma chamada Vision demora
    this.inFlight = true;
    try {
      const pending = await this.attachments.listPending(BATCH_SIZE);
      if (pending.length === 0) return;
      this.logger.log(`Processando ${pending.length} attachment(s)…`);
      for (const att of pending) {
        try {
          await this.attachments.processAttachment(att);
        } catch (err) {
          this.logger.warn(
            `att ${att.id} crashed: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
