import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { PublishRunnerService } from './publish-runner.service';

const TICK_INTERVAL_MS = 60 * 1000; // 1min
const STARTUP_DELAY_MS = 6 * 60 * 1000; // 6min — depois dos outros workers

interface DuePostRow {
  clip_id: string;
  org_id: string;
  status: string;
  scheduled_at: string | null;
  publish_attempts: number | null;
  clip: { status: string } | null;
}

/**
 * PublishWorker — reconciliação/agendamento da publicação. Acha clip_posts
 * "devidos" (corte aprovado/agendado, post ainda não publicado, na hora certa)
 * e dispara o PublishRunner por corte. Idempotente (o runner checa external_post_id).
 *
 * Imediato: setClipStatus(aprovado) já chama publishClip fire-and-forget; este
 * worker cobre agendados, auto-aprovados e retries.
 *
 * Kill: DISABLE_CORTES_PUBLISHER=true.
 */
@Injectable()
export class PublishWorker implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(PublishWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private startupTimeout: NodeJS.Timeout | null = null;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly runner: PublishRunnerService,
  ) {}

  onModuleInit(): void {
    if (process.env.DISABLE_CORTES_PUBLISHER === 'true') {
      this.log.warn('DISABLE_CORTES_PUBLISHER=true — publisher desligado');
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
      const nowIso = new Date().toISOString();
      const { data } = await this.supabase.adminClient
        .from('clip_posts')
        .select('clip_id, org_id, status, scheduled_at, publish_attempts, clip:clips(status)')
        .is('external_post_id', null)
        // inclui 'falhou' p/ retry automático (ex: depois de habilitar a API
        // do YouTube); o cap de publish_attempts evita loop infinito.
        .in('status', ['rascunho', 'agendado', 'falhou'])
        .lt('publish_attempts', 3)
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
        .limit(200);

      // supabase-js infere o embed to-one como array; o runtime é objeto.
      const rows = (data ?? []) as unknown as DuePostRow[];
      // Dedup por (org, clip) — o runner publica todos os posts devidos do corte.
      const seen = new Set<string>();
      const clips: Array<{ orgId: string; clipId: string }> = [];
      for (const r of rows) {
        const clipStatus = r.clip?.status;
        if (clipStatus !== 'aprovado' && clipStatus !== 'agendado') continue;
        const key = `${r.org_id}:${r.clip_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        clips.push({ orgId: r.org_id, clipId: r.clip_id });
      }
      if (!clips.length) return;

      let pub = 0;
      let fail = 0;
      for (const c of clips) {
        try {
          const r = await this.runner.publishClip(c.orgId, c.clipId);
          pub += r.published;
          fail += r.failed;
        } catch (err) {
          this.log.warn(`[publisher] clip ${c.clipId} falhou: ${String(err)}`);
        }
      }
      if (pub || fail) this.log.log(`[publisher] tick: ${pub} publicados, ${fail} falhas`);
    } catch (err) {
      this.log.warn(`[publisher] tick falhou: ${String(err)}`);
    }
  }
}
