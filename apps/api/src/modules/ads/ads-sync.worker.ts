import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { AdsSyncService } from './ads-sync.service';

const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
/** Atraso da 1ª rodada após boot — dá margem pra subir tudo (Baileys, etc.) */
const BOOT_DELAY_MS = 5 * 60 * 1000;
/** Janela de incremento por tick — só pega os últimos N dias. */
const INCREMENTAL_DAYS = 7;

/**
 * Worker que roda de hora em hora pra cada `ad_integration` ativa,
 * sincronizando campaigns + insights. Best-effort: falha em uma
 * integração não para o ciclo das outras.
 *
 * Backfill de 90 dias é responsabilidade do callback OAuth (chama
 * `AdsSyncService.backfillIntegration`), não desse worker.
 *
 * Pra desabilitar em dev: `DISABLE_ADS_SYNC_WORKER=true`.
 */
@Injectable()
export class AdsSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdsSyncWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(private readonly sync: AdsSyncService) {}

  onModuleInit(): void {
    if (process.env.DISABLE_ADS_SYNC_WORKER === 'true') {
      this.logger.warn('Worker de ads-sync desabilitado via env');
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
    this.logger.log(
      `Worker iniciado — ciclo de ${TICK_INTERVAL_MS / 60_000}min, janela ${INCREMENTAL_DAYS}d`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const ids = await this.sync.listActiveMetaIntegrations();
      if (ids.length === 0) return;
      this.logger.log(`Tick — ${ids.length} integração(ões) Meta ativa(s)`);

      for (const id of ids) {
        try {
          const result = await this.sync.syncIntegration(id, INCREMENTAL_DAYS);
          this.logger.log(
            `integration=${id} campaigns=${result.campaigns_upserted} metrics=${result.metrics_upserted} took=${result.duration_ms}ms`,
          );
        } catch (err) {
          // Erros granulares já foram logados por dentro do AdsSyncService
          // (incluindo flag de status na ad_integration). Aqui só seguimos
          // pro próximo.
          this.logger.warn(
            `integration=${id} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.inFlight = false;
    }
  }
}
