import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AdsAccountsService } from './ads-accounts.service';
import { AdsIngestService } from './ads-ingest.service';
import { AdsAnalyzeService } from './analysis/ads-analyze.service';

/**
 * Worker de polling do Ads Performance Agent. Tick de hora em hora; a cadência
 * real por conta (1h/3h/6h) é decidida por spend_tier dentro de listPollable.
 *
 * Mesmo padrão dos outros workers do Active (setInterval + boot delay, sem
 * @nestjs/schedule). Best-effort: falha numa conta marca a conta e segue.
 *
 * ⚠️ Meta NÃO tem webhook de performance — insights só por polling. Por isso
 * este worker existe (e existirá pra toda plataforma).
 *
 * Disable via DISABLE_ADS_AGENT_WORKER=true (setar nos processos extra que
 * rodem o AppModule, ex.: apps/workers, pra não duplicar chamadas de API).
 *
 * MVP-1 = só INGEST+SYNC (leitura). Os passos ANALYZE/DECIDE/ACT entram no
 * MVP-2/3 e serão encadeados aqui depois da ingestão.
 */
const TICK_INTERVAL_MS = 60 * 60 * 1000; // 1h
const BOOT_DELAY_MS = 6 * 60 * 1000; // 6min — depois dos outros workers subirem
const INCREMENTAL_DAYS = 7;

@Injectable()
export class AdsAgentWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdsAgentWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimeout: NodeJS.Timeout | null = null;
  private inFlight = false;

  constructor(
    private readonly accounts: AdsAccountsService,
    private readonly ingest: AdsIngestService,
    private readonly analyze: AdsAnalyzeService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_ADS_AGENT_WORKER === 'true') {
      this.logger.warn('DISABLE_ADS_AGENT_WORKER=true — worker desligado');
      return;
    }
    this.bootTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, BOOT_DELAY_MS);
    this.logger.log(
      `AdsAgentWorker armado — tick a cada ${TICK_INTERVAL_MS / 60_000}min, janela ${INCREMENTAL_DAYS}d`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimeout) clearTimeout(this.bootTimeout);
  }

  async tick(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const due = await this.accounts.listPollable(Date.now());
      if (due.length === 0) return;
      this.logger.log(`Tick — ${due.length} conta(s) pra coletar`);

      for (const account of due) {
        try {
          await this.ingest.ingestAccount(account.id, INCREMENTAL_DAYS);
        } catch (err) {
          // markError já foi chamado dentro do ingest. Aqui só seguimos.
          this.logger.warn(
            `conta=${account.id} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
          continue; // sem ingest não faz sentido analisar
        }
        // ANALYZE (copiloto) — best-effort. O service já barra quando não há
        // ≥48h de dados, então não queima token à toa.
        try {
          await this.analyze.analyzeAccount(account.id);
        } catch (err) {
          this.logger.warn(
            `analyze conta=${account.id} falhou: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      this.logger.error(
        `tick falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.inFlight = false;
    }
  }
}
