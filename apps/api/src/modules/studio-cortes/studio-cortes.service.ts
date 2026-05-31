import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CortesDriveClient } from './cortes-drive.client';
import { ClippingRunnerService } from './clipping/clipping-runner.service';
import { CopyRunnerService } from './copy/copy-runner.service';
import { PublishRunnerService } from './publish/publish-runner.service';
import { ClipMetricsRunnerService } from './publish/clip-metrics-runner.service';
import type {
  Clip,
  ClipPlatform,
  ClipStatus,
  ContentJob,
  JobSourceType,
} from './studio-cortes.types';

export interface UploadedMaster {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
  size: number;
}

const MAX_MASTER_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const CLIP_STATUSES: ClipStatus[] = ['a_revisar', 'aprovado', 'agendado', 'publicado', 'falhou'];
const PLATFORMS: ClipPlatform[] = ['instagram', 'tiktok', 'youtube'];

@Injectable()
export class StudioCortesService {
  private readonly log = new Logger(StudioCortesService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly drive: CortesDriveClient,
    private readonly clipping: ClippingRunnerService,
    private readonly copyRunner: CopyRunnerService,
    private readonly publish: PublishRunnerService,
    private readonly clipMetrics: ClipMetricsRunnerService,
  ) {}

  // ── Upload ────────────────────────────────────────────────

  /**
   * Recebe o master, grava no Shared Drive em /cortes/{job_id}/ e cria o
   * content_job (received). Depois submete o corte (async — não bloqueia a
   * resposta do upload, e creds faltando no provedor não derrubam o upload).
   */
  async createUploadJob(
    orgId: string,
    userId: string,
    file: UploadedMaster,
    title?: string,
  ): Promise<ContentJob> {
    if (!file?.buffer?.length) throw new BadRequestException('Arquivo de vídeo vazio.');
    if (file.size > MAX_MASTER_BYTES) {
      throw new BadRequestException('Master maior que 2GB. Reduza ou use a fonte por YouTube/Drive.');
    }
    if (!(await this.drive.isConfiguredForOrg(orgId))) {
      throw new BadRequestException(
        'Google Drive não conectado. Conecte sua conta Google no Studio de Cortes.',
      );
    }

    // 1. Cria o job primeiro (pra ter o id que vira nome da pasta).
    const { data: created, error: insErr } = await this.supabase.adminClient
      .from('content_jobs')
      .insert({
        org_id: orgId,
        title: title?.trim() || file.originalname,
        source_type: 'upload' as JobSourceType,
        status: 'received',
        created_by: null, // FK é org_members.id; guardamos o auth user no metadata
        metadata: { created_by_user_id: userId, original_filename: file.originalname },
      })
      .select('*')
      .single();
    if (insErr) throw new Error(`Falha ao criar job: ${insErr.message}`);
    const job = created as ContentJob;

    // 2. Grava o master no Shared Drive.
    try {
      const folderId = await this.drive.ensureJobFolder(orgId, job.id);
      const ext = file.originalname.split('.').pop()?.toLowerCase() || 'mp4';
      const driveFile = await this.drive.uploadFile(
        orgId,
        folderId,
        `master.${ext}`,
        file.buffer,
        file.mimetype || 'video/mp4',
      );
      const { data: updated } = await this.supabase.adminClient
        .from('content_jobs')
        .update({ drive_file_id: driveFile.id, drive_folder_id: folderId })
        .eq('id', job.id)
        .select('*')
        .single();
      const ready = (updated as ContentJob | null) ?? { ...job, drive_file_id: driveFile.id, drive_folder_id: folderId };

      // 3. Submete o corte async (webhook conclui depois).
      void this.clipping.submit(ready).catch((err) => {
        this.log.error(`[upload] submit do corte falhou (job ${job.id}): ${String(err)}`);
      });

      return ready;
    } catch (err) {
      await this.supabase.adminClient
        .from('content_jobs')
        .update({ status: 'failed', failure_reason: `Upload pro Drive falhou: ${String(err)}` })
        .eq('id', job.id);
      throw err;
    }
  }

  // ── Leitura ───────────────────────────────────────────────

  async listJobs(orgId: string): Promise<ContentJob[]> {
    const { data, error } = await this.supabase.adminClient
      .from('content_jobs')
      .select('*')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return (data ?? []) as ContentJob[];
  }

  /** Board (kanban): cortes + suas copys + info do job, pra agrupar por status. */
  async getBoard(orgId: string): Promise<{
    columns: Record<ClipStatus, unknown[]>;
  }> {
    const { data, error } = await this.supabase.adminClient
      .from('clips')
      .select('*, posts:clip_posts(*), job:content_jobs(id,title,status,source_type)')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false })
      .limit(300);
    if (error) throw new Error(error.message);

    const columns = Object.fromEntries(CLIP_STATUSES.map((s) => [s, [] as unknown[]])) as Record<
      ClipStatus,
      unknown[]
    >;
    for (const row of (data ?? []) as Array<Clip & { status: ClipStatus }>) {
      (columns[row.status] ??= []).push(row);
    }
    return { columns };
  }

  // ── Mutação (board) ───────────────────────────────────────

  /** Move um corte de coluna (só muda estado — publicação é Sprint 2). */
  async setClipStatus(orgId: string, clipId: string, status: ClipStatus): Promise<Clip> {
    if (!CLIP_STATUSES.includes(status)) throw new BadRequestException(`Status inválido: ${status}`);
    // 'publicado' é definido pelo sistema após publicar — não é destino de
    // arraste manual (a UI já bloqueia; isto é defesa extra).
    if (status === 'publicado') {
      throw new BadRequestException(
        'Mover pra "Publicado" é automático: aprove o corte e o sistema publica + marca como publicado.',
      );
    }
    const { data, error } = await this.supabase.adminClient
      .from('clips')
      .update({ status })
      .eq('id', clipId)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Corte não encontrado.');

    // Aprovado dispara a publicação nativa (async — não bloqueia a resposta).
    // 'agendado' fica pro worker disparar na hora do scheduled_at.
    if (status === 'aprovado') {
      void this.publish.publishClip(orgId, clipId).catch((err) => {
        this.log.error(`[publish] disparo no aprovar falhou (clip ${clipId}): ${String(err)}`);
      });
    }
    return data as Clip;
  }

  /**
   * Agenda (ou desagenda) a publicação de um corte. Com data → posts ganham
   * scheduled_at + status 'agendado', e o corte vai pra coluna "Agendado"
   * (o worker publica na hora marcada → recompute → "Publicado"). Sem data →
   * volta pra "A revisar".
   */
  async scheduleClip(orgId: string, clipId: string, scheduledAt: string | null): Promise<Clip> {
    const { data: clipData } = await this.supabase.adminClient
      .from('clips')
      .select('id')
      .eq('id', clipId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!clipData) throw new NotFoundException('Corte não encontrado.');

    if (scheduledAt) {
      const when = new Date(scheduledAt);
      if (Number.isNaN(when.getTime())) throw new BadRequestException('Data inválida.');
      if (when.getTime() < Date.now() - 60_000) {
        throw new BadRequestException('Escolha um horário no futuro.');
      }
      // Só mexe nos posts ainda não publicados.
      await this.supabase.adminClient
        .from('clip_posts')
        .update({ scheduled_at: when.toISOString(), status: 'agendado', error: null })
        .eq('clip_id', clipId)
        .eq('org_id', orgId)
        .neq('status', 'publicado');
      await this.supabase.adminClient
        .from('clips')
        .update({ status: 'agendado' })
        .eq('id', clipId)
        .eq('org_id', orgId);
    } else {
      await this.supabase.adminClient
        .from('clip_posts')
        .update({ scheduled_at: null, status: 'rascunho' })
        .eq('clip_id', clipId)
        .eq('org_id', orgId)
        .neq('status', 'publicado');
      await this.supabase.adminClient
        .from('clips')
        .update({ status: 'a_revisar' })
        .eq('id', clipId)
        .eq('org_id', orgId);
    }

    const { data } = await this.supabase.adminClient
      .from('clips')
      .select('*')
      .eq('id', clipId)
      .eq('org_id', orgId)
      .single();
    return data as Clip;
  }

  /** Edita a copy de um corte em uma plataforma. */
  async updateClipPost(
    orgId: string,
    postId: string,
    patch: {
      title?: string | null;
      copy?: string | null;
      hashtags?: string[];
      scheduled_at?: string | null;
      account_id?: string | null;
    },
  ): Promise<unknown> {
    const fields: Record<string, unknown> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.copy !== undefined) fields.copy = patch.copy;
    if (patch.hashtags !== undefined) fields.hashtags = patch.hashtags;
    if (patch.scheduled_at !== undefined) fields.scheduled_at = patch.scheduled_at;
    if (patch.account_id !== undefined) fields.account_id = patch.account_id;
    if (Object.keys(fields).length === 0) throw new BadRequestException('Nada pra atualizar.');

    const { data, error } = await this.supabase.adminClient
      .from('clip_posts')
      .update(fields)
      .eq('id', postId)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Copy não encontrada.');
    return data;
  }

  /** Toggle auto-aprovar / renomear job. */
  async updateJob(
    orgId: string,
    jobId: string,
    patch: { auto_approve?: boolean; title?: string },
  ): Promise<ContentJob> {
    const fields: Record<string, unknown> = {};
    if (patch.auto_approve !== undefined) fields.auto_approve = patch.auto_approve;
    if (patch.title !== undefined) fields.title = patch.title;
    if (Object.keys(fields).length === 0) throw new BadRequestException('Nada pra atualizar.');

    const { data, error } = await this.supabase.adminClient
      .from('content_jobs')
      .update(fields)
      .eq('id', jobId)
      .eq('org_id', orgId)
      .select('*')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Job não encontrado.');
    return data as ContentJob;
  }

  /** Regera as copys de um job (re-dispara o CopyRunner). */
  async regenerateCopy(orgId: string, jobId: string): Promise<{ generated: number }> {
    const { data } = await this.supabase.adminClient
      .from('content_jobs')
      .select('id')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!data) throw new NotFoundException('Job não encontrado.');
    return this.copyRunner.runForJob(orgId, jobId);
  }

  /** Reenvia um job ao provedor de corte (reusa o master no Drive). Pra jobs
   *  presos/falhos (ex: o provedor não conseguiu baixar a fonte). */
  async retryClip(orgId: string, jobId: string): Promise<{ ok: true }> {
    const { data } = await this.supabase.adminClient
      .from('content_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('org_id', orgId)
      .maybeSingle();
    const job = data as ContentJob | null;
    if (!job) throw new NotFoundException('Job não encontrado.');
    if (!job.drive_file_id && job.source_type === 'upload') {
      throw new BadRequestException('Job sem master no Drive — não dá pra reenviar.');
    }
    await this.supabase.adminClient
      .from('content_jobs')
      .update({ status: 'received', clipping_job_id: null, failure_reason: null })
      .eq('id', jobId)
      .eq('org_id', orgId);
    await this.clipping.submit({ ...job, status: 'received', clipping_job_id: null });
    return { ok: true };
  }

  /** Status de configuração (Drive + provedor) — útil pro smoke e pra UI. */
  async config(orgId: string): Promise<{
    drive_connected: boolean;
    drive_email: string | null;
    youtube_ready: boolean;
    vizard_configured: boolean;
    platforms: ClipPlatform[];
  }> {
    const status = await this.drive.getStatus(orgId);
    return {
      drive_connected: status.connected,
      drive_email: status.email,
      youtube_ready: await this.drive.hasYouTubeScope(orgId),
      vizard_configured: Boolean(process.env.VIZARD_API_KEY?.trim()),
      platforms: PLATFORMS,
    };
  }

  // ── Métricas (Sprint 2) ───────────────────────────────────

  /** Refaz a coleta de métricas dos cortes publicados da org (manual/smoke). */
  refreshMetrics(orgId: string): Promise<{ updated: number }> {
    return this.clipMetrics.refreshForOrg(orgId);
  }

  /** Agregado de métricas por plataforma (pro módulo Relatórios). */
  async metricsSummary(orgId: string): Promise<{
    by_platform: Array<{
      platform: ClipPlatform;
      posts: number;
      views: number;
      likes: number;
      comments: number;
      shares: number;
    }>;
  }> {
    const { data } = await this.supabase.adminClient
      .from('clip_posts')
      .select('platform, metrics')
      .eq('org_id', orgId)
      .eq('status', 'publicado')
      .limit(2000);
    const rows = (data ?? []) as Array<{ platform: ClipPlatform; metrics: Record<string, number> }>;
    const acc = new Map<
      ClipPlatform,
      { platform: ClipPlatform; posts: number; views: number; likes: number; comments: number; shares: number }
    >();
    for (const p of PLATFORMS) acc.set(p, { platform: p, posts: 0, views: 0, likes: 0, comments: 0, shares: 0 });
    for (const r of rows) {
      const a = acc.get(r.platform);
      if (!a) continue;
      a.posts += 1;
      a.views += Number(r.metrics?.views ?? 0);
      a.likes += Number(r.metrics?.likes ?? 0);
      a.comments += Number(r.metrics?.comments ?? 0);
      a.shares += Number(r.metrics?.shares ?? 0);
    }
    return { by_platform: Array.from(acc.values()) };
  }

  // ── OAuth do Google Drive (passthrough pro client) ─────────

  getGoogleAuthUrl(orgId: string): { url: string } {
    return { url: this.drive.getAuthUrl(orgId) };
  }

  googleStatus(orgId: string): Promise<{ connected: boolean; email: string | null }> {
    return this.drive.getStatus(orgId);
  }

  async googleDisconnect(orgId: string): Promise<{ ok: true }> {
    await this.drive.disconnect(orgId);
    return { ok: true };
  }
}
