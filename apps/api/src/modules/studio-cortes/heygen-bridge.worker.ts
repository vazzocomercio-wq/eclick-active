import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { StudioCortesService } from './studio-cortes.service';

const TICK_INTERVAL_MS = 60 * 1000; // 1min
const STARTUP_DELAY_MS = 3 * 60 * 1000; // 3min

/**
 * Ponte AUTOMÁTICA HeyGen → Cortes. Varre os jobs HeyGen que:
 *   • concluíram (status='completed', com video_url),
 *   • têm auto_cortes=true (o usuário ligou a automação no início do fluxo),
 *   • e ainda não geraram corte (cortes_job_id IS NULL),
 * e dispara o Studio de Cortes pra cada um.
 *
 * GATED por env CORTES_AUTO_FROM_HEYGEN=true. DESLIGADO por padrão — cortar no
 * Vizard custa crédito/$, então a automação completa só roda depois de
 * validarmos e ligarmos a env explicitamente. createJobFromHeyGen é idempotente
 * (carimba cortes_job_id), então não dispara o mesmo corte duas vezes.
 */
@Injectable()
export class HeygenBridgeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(HeygenBridgeWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cortes: StudioCortesService,
  ) {}

  private enabled(): boolean {
    return process.env.CORTES_AUTO_FROM_HEYGEN === 'true';
  }

  onModuleInit(): void {
    if (!this.enabled()) {
      this.log.log('CORTES_AUTO_FROM_HEYGEN != true — automação HeyGen→Cortes desligada (em validação)');
      return;
    }
    this.log.warn('CORTES_AUTO_FROM_HEYGEN=true — automação HeyGen→Cortes LIGADA');
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
    if (!this.enabled()) return;
    try {
      const { data } = await this.supabase.adminClient
        .from('heygen_jobs')
        .select('id, org_id')
        .eq('status', 'completed')
        .eq('auto_cortes', true)
        .is('cortes_job_id', null)
        .not('video_url', 'is', null)
        .limit(20);
      const jobs = (data ?? []) as Array<{ id: string; org_id: string }>;
      if (!jobs.length) return;

      let fired = 0;
      for (const hg of jobs) {
        try {
          await this.cortes.createJobFromHeyGen(hg.org_id, hg.id);
          fired += 1;
        } catch (err) {
          this.log.warn(`[heygen-bridge] job ${hg.id}: ${String(err)}`);
        }
      }
      if (fired) this.log.log(`[heygen-bridge] ${fired}/${jobs.length} cortes disparados`);
    } catch (err) {
      this.log.warn(`[heygen-bridge] tick falhou: ${String(err)}`);
    }
  }
}
