import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { TrendsCollectorService } from './trends-collector.service';
import { TrendsBriefService } from './trends-brief.service';
import { TrendsAlerterService } from './trends-alerter.service';
import { TrendsService } from './trends.service';

const TICK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h (cota YouTube + Trends é diária)
const STARTUP_DELAY_MS = 3 * 60 * 1000; // 3min — depois dos outros workers subirem

/**
 * Worker de coleta de tendências. 1×/dia, pra cada org com monitor ativo de
 * rede já suportada (youtube/google_trends), dispara TrendsCollectorService.
 *
 * Mesmo padrão dos outros workers do Active (setInterval + startup delay, sem
 * @nestjs/schedule). Disable via TRENDS_COLLECTOR_DISABLED=true (setar nos
 * processos extra que rodem o AppModule pra não duplicar chamadas de API).
 */
@Injectable()
export class TrendsCollectorWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(TrendsCollectorWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly collector: TrendsCollectorService,
    private readonly briefs: TrendsBriefService,
    private readonly alerter: TrendsAlerterService,
    private readonly trends: TrendsService,
  ) {}

  onModuleInit(): void {
    if (process.env.TRENDS_COLLECTOR_DISABLED === 'true') {
      this.log.warn('TRENDS_COLLECTOR_DISABLED=true — worker desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log(`TrendsCollectorWorker armado — tick a cada ${TICK_INTERVAL_MS / 3600000}h`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    try {
      const { data } = await this.supabase.adminClient
        .from('trend_monitors')
        .select('org_id')
        .eq('is_active', true)
        .in('network', ['youtube', 'google_trends', 'tiktok']);
      const orgIds = Array.from(
        new Set((data ?? []).map((r: { org_id: string }) => r.org_id)),
      );
      if (orgIds.length === 0) return;

      let totalItems = 0;
      let totalBriefs = 0;
      let totalAlerts = 0;
      for (const orgId of orgIds) {
        try {
          const collected = await this.collector.collectAll(orgId);
          totalItems += collected.items;
          if (collected.items > 0) {
            // autopilot diário: gera pautas + dispara digest dos sinais fortes
            const gen = await this.briefs.generate(orgId);
            totalBriefs += gen.briefs;
            const signals = await this.trends.listSignals(orgId, 5);
            const a = await this.alerter.alertDigest(orgId, signals, gen.briefs);
            totalAlerts += a.delivered;
          }
        } catch (err) {
          this.log.warn(`org ${orgId} falhou: ${String(err)}`);
        }
      }
      this.log.log(
        `tick: ${orgIds.length} orgs, ${totalItems} itens, ${totalBriefs} pautas, ${totalAlerts} alertas`,
      );
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
    }
  }
}
