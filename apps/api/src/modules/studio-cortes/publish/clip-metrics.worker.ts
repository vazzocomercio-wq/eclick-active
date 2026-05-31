import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { ClipMetricsRunnerService } from './clip-metrics-runner.service';

const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STARTUP_DELAY_MS = 8 * 60 * 1000; // 8min

/**
 * Reconciliação de métricas dos cortes publicados. 1×/6h por org com posts
 * publicados. Kill: DISABLE_CORTES_METRICS=true.
 */
@Injectable()
export class ClipMetricsWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(ClipMetricsWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly runner: ClipMetricsRunnerService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_CORTES_METRICS === 'true') {
      this.log.warn('DISABLE_CORTES_METRICS=true — métricas desligadas');
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
      const { data } = await this.supabase.adminClient
        .from('clip_posts')
        .select('org_id')
        .eq('status', 'publicado')
        .limit(5000);
      const orgIds = Array.from(new Set((data ?? []).map((r: { org_id: string }) => r.org_id)));
      let total = 0;
      for (const orgId of orgIds) {
        try {
          const r = await this.runner.refreshForOrg(orgId);
          total += r.updated;
        } catch (err) {
          this.log.warn(`[metrics] org ${orgId} falhou: ${String(err)}`);
        }
      }
      if (total) this.log.log(`[metrics] tick: ${total} posts atualizados`);
    } catch (err) {
      this.log.warn(`[metrics] tick falhou: ${String(err)}`);
    }
  }
}
