import { Controller, Get, Logger, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Readable } from 'node:stream';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CortesDriveClient } from './cortes-drive.client';

/**
 * Proxy de fonte do master pro provedor de corte (Vizard). SEM AuthGuard — o
 * provedor baixa daqui sem JWT; autenticação é o token assinado (HMAC) na query.
 * Faz stream do arquivo do Drive (com nosso OAuth) → evita a página anti-vírus
 * do Drive que quebra o download de arquivos grandes.
 */
@Controller('studio-cortes/source')
export class CortesSourceController {
  private readonly log = new Logger(CortesSourceController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly drive: CortesDriveClient,
  ) {}

  @Get(':jobId')
  async stream(
    @Param('jobId') jobId: string,
    @Query('t') token: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    if (!this.drive.verifySourceToken(jobId, token ?? '')) {
      res.status(403).end('forbidden');
      return;
    }
    const { data } = await this.supabase.adminClient
      .from('content_jobs')
      .select('org_id, drive_file_id')
      .eq('id', jobId)
      .maybeSingle();
    const job = data as { org_id: string; drive_file_id: string | null } | null;
    if (!job?.drive_file_id) {
      res.status(404).end('not found');
      return;
    }

    try {
      const driveRes = await this.drive.streamMaster(job.org_id, job.drive_file_id);
      if (!driveRes.ok || !driveRes.body) {
        this.log.warn(`[source] Drive stream falhou (job ${jobId}): HTTP ${driveRes.status}`);
        res.status(502).end('drive error');
        return;
      }
      res.setHeader('Content-Type', driveRes.headers.get('content-type') ?? 'video/mp4');
      const len = driveRes.headers.get('content-length');
      if (len) res.setHeader('Content-Length', len);
      res.setHeader('Cache-Control', 'no-store');
      // Web ReadableStream → Node stream → pipe pro response.
      Readable.fromWeb(driveRes.body as Parameters<typeof Readable.fromWeb>[0]).pipe(res);
    } catch (err) {
      this.log.error(`[source] erro (job ${jobId}): ${String(err)}`);
      if (!res.headersSent) res.status(500).end('error');
    }
  }
}
