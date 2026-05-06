import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { SocialMetricsService } from './social-metrics.service';
import { SocialSignalsService } from './social-signals.service';

const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const STARTUP_DELAY_MS = 2 * 60 * 1000; // 2min — depois dos outros workers

/**
 * Worker periódico de analytics:
 *   1. Pra cada org com posts publicados nos últimos 30 dias:
 *      - SocialMetricsService.refreshAllRecent() — puxa Insights
 *        do Instagram pra cada post (idempotente, UPSERT)
 *      - SocialSignalsService.detectAll() — detecta hits/flops/
 *        best_pillar/best_time
 *
 * Roda 6h pq:
 *   - Insights do IG não atualizam tão rápido (20-60min normal)
 *   - Cada chamada consome rate limit do app Meta
 *   - 6h × 4× ao dia = 4 fetches/post/dia, suficiente
 *
 * Disable via SOCIAL_METRICS_DISABLED=true.
 */
@Injectable()
export class SocialMetricsWorkerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly log = new Logger(SocialMetricsWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly metrics: SocialMetricsService,
    private readonly signals: SocialSignalsService,
  ) {}

  onModuleInit(): void {
    if (process.env.SOCIAL_METRICS_DISABLED === 'true') {
      this.log.warn('SOCIAL_METRICS_DISABLED=true — worker desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log(
      `SocialMetricsWorker armado — tick a cada ${TICK_INTERVAL_MS / 1000 / 60}min`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    try {
      // Pega lista de orgs que têm cred IG ativa (skip orgs sem cred)
      const { data: creds } = await this.supabase.adminClient
        .from('social_channel_credentials')
        .select('org_id')
        .eq('channel', 'instagram_business')
        .eq('is_active', true);

      const orgIds = Array.from(
        new Set((creds ?? []).map((c: { org_id: string }) => c.org_id)),
      );

      if (orgIds.length === 0) return;

      let totalRefreshed = 0;
      let totalSignals = 0;
      for (const orgId of orgIds) {
        try {
          const r = await this.metrics.refreshAllRecent(orgId, 30, 100);
          totalRefreshed += r.refreshed;

          const s = await this.signals.detectAll(orgId);
          totalSignals += s.created;
        } catch (err) {
          this.log.warn(`org ${orgId} falhou: ${String(err)}`);
        }
      }

      this.log.log(
        `tick: ${orgIds.length} orgs, ${totalRefreshed} posts atualizados, ${totalSignals} signals`,
      );
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
    }
  }
}
