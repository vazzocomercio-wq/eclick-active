import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ClippingRunnerService } from './clipping-runner.service';

const TICK_INTERVAL_MS = 2 * 60 * 1000; // 2min — sem webhook da Vizard, o reconciler é o caminho
const STARTUP_DELAY_MS = 2 * 60 * 1000; // 2min
// Só reconcilia jobs parados em 'clipping' há mais que isto (dá chance pro webhook).
const STUCK_AFTER_MS = 3 * 60 * 1000; // 3min

/**
 * Reconciler — fallback do webhook. Se o webhook de conclusão não chegar,
 * pega jobs presos em 'clipping' e faz poll no provedor. handleResult é
 * idempotente, então não há risco de duplicar cortes se o webhook chegar depois.
 *
 * Kill: DISABLE_CORTES_RECONCILER=true.
 */
@Injectable()
export class ClippingReconcilerWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ClippingReconcilerWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly clipping: ClippingRunnerService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_CORTES_RECONCILER === 'true') {
      this.log.warn('DISABLE_CORTES_RECONCILER=true — reconciler desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
      const { data } = await this.supabase.adminClient
        .from('content_jobs')
        .select('id, clipping_job_id')
        .eq('status', 'clipping')
        .not('clipping_job_id', 'is', null)
        .lt('updated_at', cutoff)
        .limit(50);
      const jobs = (data ?? []) as Array<{ id: string; clipping_job_id: string }>;
      if (!jobs.length) return;

      let reconciled = 0;
      for (const j of jobs) {
        try {
          const parsed = await this.clipping.poll(j.clipping_job_id);
          if (!parsed) continue;
          const r = await this.clipping.handleResult(parsed);
          if (r.acted) reconciled += 1;
        } catch (err) {
          this.log.warn(`[reconciler] job ${j.id}: ${String(err)}`);
        }
      }
      if (reconciled) this.log.log(`[reconciler] ${reconciled}/${jobs.length} jobs reconciliados`);
    } catch (err) {
      this.log.warn(`[reconciler] tick falhou: ${String(err)}`);
    }
  }
}
