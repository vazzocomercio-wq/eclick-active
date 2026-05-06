import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { EventsGateway } from '../../gateways/events.gateway';

const TICK_INTERVAL_MS = 60 * 1000; // 1min
const STARTUP_DELAY_MS = 45 * 1000;

/**
 * Worker periódico do Social AI Studio. Roda a cada 1min:
 *
 *   1. Busca contents com status='scheduled' e scheduled_for vencendo
 *      em ≤15min — emite evento `social:scheduled-soon` pra UI alertar
 *      o usuário ("conteúdo X publica em 15min, prepare-se").
 *
 *   2. Busca contents com status='scheduled' que JÁ passaram de
 *      scheduled_for — muda pra 'pending_publication' e emite
 *      `social:ready-to-publish` (no MVP 1, publicação é manual; o
 *      usuário recebe a notificação e publica via export).
 *
 * Multi-tenant: emite por org_id no socket.io. Não publica
 * automaticamente — isso fica pro MVP 2 quando integração com
 * Instagram Graph API estiver pronta.
 */
@Injectable()
export class SocialSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(SocialSchedulerService.name);
  private tickTimer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly events: EventsGateway,
  ) {}

  onModuleInit(): void {
    if (process.env.SOCIAL_SCHEDULER_DISABLED === 'true') {
      this.log.warn('SOCIAL_SCHEDULER_DISABLED=true — scheduler desligado');
      return;
    }
    this.startupTimeout = setTimeout(() => {
      void this.tick();
      this.tickTimer = setInterval(() => void this.tick(), TICK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
    this.log.log(`SocialScheduler armado — tick a cada ${TICK_INTERVAL_MS / 1000}s`);
  }

  onModuleDestroy(): void {
    if (this.tickTimer) clearInterval(this.tickTimer);
    if (this.startupTimeout) clearTimeout(this.startupTimeout);
  }

  private async tick(): Promise<void> {
    try {
      const now = new Date();
      const in15Min = new Date(now.getTime() + 15 * 60_000);

      // ── Soon (alertar usuário) ──
      const { data: soonRows } = await this.supabase.adminClient
        .from('social_contents')
        .select('id, org_id, scheduled_for, content_type, title')
        .eq('status', 'scheduled')
        .gt('scheduled_for', now.toISOString())
        .lte('scheduled_for', in15Min.toISOString())
        .limit(100);

      for (const row of (soonRows ?? []) as Array<{
        id: string;
        org_id: string;
        scheduled_for: string;
        content_type: string;
        title: string | null;
      }>) {
        try {
          this.events.emitToOrg(row.org_id, 'social:scheduled-soon', {
            content_id: row.id,
            scheduled_for: row.scheduled_for,
            content_type: row.content_type,
            title: row.title,
          });
        } catch {
          /* best-effort */
        }
      }

      // ── Ready (passou da hora — usuário precisa publicar) ──
      const { data: readyRows } = await this.supabase.adminClient
        .from('social_contents')
        .select('id, org_id, scheduled_for, content_type, title')
        .eq('status', 'scheduled')
        .lte('scheduled_for', now.toISOString())
        .limit(100);

      for (const row of (readyRows ?? []) as Array<{
        id: string;
        org_id: string;
        scheduled_for: string;
        content_type: string;
        title: string | null;
      }>) {
        try {
          this.events.emitToOrg(row.org_id, 'social:ready-to-publish', {
            content_id: row.id,
            scheduled_for: row.scheduled_for,
            content_type: row.content_type,
            title: row.title,
          });
        } catch {
          /* best-effort */
        }
      }
    } catch (err) {
      this.log.warn(`tick falhou: ${String(err)}`);
    }
  }
}
