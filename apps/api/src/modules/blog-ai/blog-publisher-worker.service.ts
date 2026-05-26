import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { BlogAiService } from './blog-ai.service';

const TICK_INTERVAL_MS = 60 * 1000; // 1min
const STARTUP_DELAY_MS = 90 * 1000;
const MAX_PER_TICK = 5;

/**
 * Worker de publicação agendada do blog. A cada 1min pega posts com
 * status='scheduled' cujo scheduled_for já venceu e publica (reusa
 * BlogAiService.publish → Sanity). Falha marca status='failed' (não
 * re-tenta em loop). Desligável via env BLOG_PUBLISHER_DISABLED=true.
 *
 * Espelha o padrão de social/publishing/social-publisher-worker.
 */
@Injectable()
export class BlogPublisherWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(BlogPublisherWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly blog: BlogAiService,
  ) {}

  onModuleInit(): void {
    if (process.env.BLOG_PUBLISHER_DISABLED === 'true') {
      this.log.warn('BLOG_PUBLISHER_DISABLED=true — worker desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log(`BlogPublisherWorker armado — tick a cada ${TICK_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date().toISOString();
      const { data } = await this.supabase.adminClient
        .from('blog_posts')
        .select('id, org_id')
        .eq('status', 'scheduled')
        .lte('scheduled_for', now)
        .order('scheduled_for', { ascending: true })
        .limit(MAX_PER_TICK);

      const queue = (data ?? []) as Array<{ id: string; org_id: string }>;
      if (queue.length === 0) return;

      let ok = 0;
      let fail = 0;
      for (const row of queue) {
        try {
          await this.blog.publish(row.org_id, row.id);
          ok += 1;
        } catch (e) {
          fail += 1;
          const msg = (e as Error).message;
          this.log.warn(`publish agendado ${row.id} falhou: ${msg}`);
          await this.supabase.adminClient
            .from('blog_posts')
            .update({ status: 'failed', rejected_reason: `agendamento: ${msg}`.slice(0, 500) })
            .eq('id', row.id);
        }
      }
      if (ok + fail > 0) this.log.log(`tick: ${ok} publicados, ${fail} falhas`);
    } catch (e) {
      this.log.warn(`tick falhou: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }
}
