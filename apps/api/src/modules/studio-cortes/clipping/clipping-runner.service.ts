import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { CortesDriveClient } from '../cortes-drive.client';
import { CopyRunnerService } from '../copy/copy-runner.service';
import {
  CLIPPING_PROVIDER,
  type ClippingProvider,
  type ContentJob,
  type ParsedClipping,
} from '../studio-cortes.types';

/**
 * Orquestra o corte: submete o master ao provedor e processa a conclusão
 * (webhook ou poll do reconciler). Idempotente — checa estado antes de agir.
 */
@Injectable()
export class ClippingRunnerService {
  private readonly log = new Logger(ClippingRunnerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly drive: CortesDriveClient,
    private readonly copyRunner: CopyRunnerService,
    @Inject(CLIPPING_PROVIDER) private readonly provider: ClippingProvider,
  ) {}

  private webhookUrl(): string | undefined {
    const base = process.env.API_PUBLIC_URL ?? process.env.PUBLIC_API_URL;
    return base ? `${base.replace(/\/$/, '')}/webhooks/clipping` : undefined;
  }

  /** Submete o job ao provedor de corte. Chamado logo após o upload. */
  async submit(job: ContentJob): Promise<void> {
    let sourceUrl: string;
    if (job.source_type === 'youtube') {
      if (!job.youtube_video_id) throw new BadRequestException('Job sem youtube_video_id');
      sourceUrl = `https://www.youtube.com/watch?v=${job.youtube_video_id}`;
    } else {
      if (!job.drive_file_id) throw new BadRequestException('Job sem master no Drive');
      sourceUrl = await this.drive.makeSourceUrl(job.drive_file_id);
    }

    const { clipping_job_id } = await this.provider.submit(sourceUrl, {
      jobId: job.id,
      webhookUrl: this.webhookUrl(),
      language: 'pt',
      sourceType: job.source_type,
    });

    await this.supabase.adminClient
      .from('content_jobs')
      .update({
        clipping_provider: this.provider.name,
        clipping_job_id,
        status: 'clipping',
      })
      .eq('id', job.id)
      .eq('org_id', job.org_id);

    this.log.log(`[clipping] job ${job.id} submetido → ${this.provider.name}:${clipping_job_id}`);
  }

  /**
   * Processa um resultado de corte (do webhook OU do reconciler). Idempotente:
   * só age se o job ainda está em 'clipping'.
   */
  async handleResult(parsed: ParsedClipping): Promise<{ acted: boolean; reason?: string }> {
    const { data } = await this.supabase.adminClient
      .from('content_jobs')
      .select('*')
      .eq('clipping_provider', this.provider.name)
      .eq('clipping_job_id', parsed.clipping_job_id)
      .maybeSingle();
    const job = data as ContentJob | null;
    if (!job) return { acted: false, reason: 'job_not_found' };
    if (job.status !== 'clipping') return { acted: false, reason: `job_status:${job.status}` };

    if (parsed.state === 'processing') return { acted: false, reason: 'still_processing' };

    if (parsed.state === 'failed') {
      await this.supabase.adminClient
        .from('content_jobs')
        .update({ status: 'failed', failure_reason: parsed.error ?? 'Provedor falhou' })
        .eq('id', job.id);
      this.log.warn(`[clipping] job ${job.id} falhou: ${parsed.error}`);
      return { acted: true, reason: 'failed' };
    }

    // completed — cria os clips (idempotente via unique (job_id, provider_clip_id))
    if (parsed.clips.length === 0) {
      await this.supabase.adminClient
        .from('content_jobs')
        .update({ status: 'failed', failure_reason: 'Provedor não retornou cortes' })
        .eq('id', job.id);
      return { acted: true, reason: 'no_clips' };
    }

    const rows = parsed.clips.map((c, i) => ({
      job_id: job.id,
      org_id: job.org_id,
      provider_clip_id: c.provider_clip_id,
      title: c.title ?? null,
      file_url: c.file_url ?? null,
      duration_seconds: c.duration_seconds ?? null,
      start_seconds: c.start_seconds ?? null,
      end_seconds: c.end_seconds ?? null,
      width: c.width ?? null,
      height: c.height ?? null,
      thumbnail_url: c.thumbnail_url ?? null,
      transcript: c.transcript ?? null,
      hook: c.hook ?? null,
      status: 'a_revisar' as const,
      order_index: i,
      metadata: c.extra ?? {},
    }));

    const { error } = await this.supabase.adminClient
      .from('clips')
      .upsert(rows, { onConflict: 'job_id,provider_clip_id', ignoreDuplicates: true });
    if (error) {
      this.log.error(`[clipping] insert clips falhou: ${error.message}`);
      throw new Error(error.message);
    }

    await this.supabase.adminClient
      .from('content_jobs')
      .update({
        status: 'generating_copy',
        transcript: parsed.transcript ?? job.transcript,
      })
      .eq('id', job.id);

    this.log.log(`[clipping] job ${job.id} → ${rows.length} cortes, gerando copys`);

    // CopyRunner roda async (webhook responde rápido); ele leva o job a 'in_review'.
    void this.copyRunner.runForJob(job.org_id, job.id).catch((err) => {
      this.log.error(`[clipping] copyRunner job ${job.id} falhou: ${String(err)}`);
    });

    return { acted: true, reason: 'clips_created' };
  }

  /** Traduz o payload bruto do webhook via provedor. */
  parseWebhook(payload: unknown): ParsedClipping | null {
    return this.provider.parseWebhook(payload);
  }

  /** Poll de um job (reconciler). */
  poll(clippingJobId: string): Promise<ParsedClipping | null> {
    return this.provider.poll(clippingJobId);
  }
}
