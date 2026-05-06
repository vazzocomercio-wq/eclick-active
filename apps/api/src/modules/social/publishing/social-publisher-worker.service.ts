import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { SocialPublishingService } from './social-publishing.service';

const TICK_INTERVAL_MS = 60 * 1000; // 1min
const STARTUP_DELAY_MS = 90 * 1000; // 1.5min — depois do scheduler base
const MAX_PER_TICK = 10;

/**
 * Worker que efetivamente publica conteúdos agendados que já passaram
 * de scheduled_for. Roda 1min, pega até 10 por tick (rate limit).
 *
 * Diferente do SocialSchedulerService (que apenas EMITE eventos
 * "soon"/"ready"), esse aqui CHAMA o provider e PUBLICA.
 *
 * Pode ser desligado via env SOCIAL_PUBLISHER_DISABLED=true (útil
 * pra ambientes onde só publicação manual é desejada).
 */
@Injectable()
export class SocialPublisherWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SocialPublisherWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly publishing: SocialPublishingService,
  ) {}

  onModuleInit(): void {
    if (process.env.SOCIAL_PUBLISHER_DISABLED === 'true') {
      this.log.warn('SOCIAL_PUBLISHER_DISABLED=true — worker desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log(
      `SocialPublisherWorker armado — tick a cada ${TICK_INTERVAL_MS / 1000}s`,
    );
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date().toISOString();
      const { data: rows } = await this.supabase.adminClient
        .from('social_contents')
        .select('id, org_id, scheduled_for, content_type, title, publish_attempts_count')
        .eq('status', 'scheduled')
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: true })
        .limit(MAX_PER_TICK);

      const queue = (rows ?? []) as Array<{
        id: string;
        org_id: string;
        scheduled_for: string;
        publish_attempts_count: number;
      }>;
      if (queue.length === 0) return;

      let published = 0;
      let failed = 0;
      for (const row of queue) {
        // Backoff: se já tentou 3+ vezes, pausa pra não martelar
        if (row.publish_attempts_count >= 3) {
          this.log.warn(
            `content ${row.id} já tentou ${row.publish_attempts_count}× — pulando`,
          );
          continue;
        }
        try {
          const r = await this.publishing.publishContent(row.org_id, row.id);
          if (r.any_success) published += 1;
          else failed += 1;
        } catch (err) {
          this.log.warn(`publish ${row.id} falhou: ${String(err)}`);
          failed += 1;
        }
      }

      if (published + failed > 0) {
        this.log.log(
          `tick processou ${queue.length}: ${published} publicados, ${failed} falhas`,
        );
      }
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
    }
  }
}
