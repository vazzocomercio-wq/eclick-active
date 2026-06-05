import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../common/supabase/supabase.service';
import { CortesDriveClient } from './cortes-drive.client';
import { ClippingRunnerService } from './clipping/clipping-runner.service';
import { CopyRunnerService } from './copy/copy-runner.service';
import { PublishRunnerService } from './publish/publish-runner.service';
import { ClipMetricsRunnerService } from './publish/clip-metrics-runner.service';
import { SocialChannelCredentialsService } from '../social/publishing/social-channel-credentials.service';
import { CortesYouTubeService } from './publish/cortes-youtube.service';
import { CortesInstagramService } from './publish/cortes-instagram.service';
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
    private readonly socialCreds: SocialChannelCredentialsService,
    private readonly cortesYouTube: CortesYouTubeService,
    private readonly cortesInstagram: CortesInstagramService,
  ) {}

  // ── Canais do YouTube (multi-canal) ───────────────────────
  getYouTubeAuthUrl(orgId: string): { url: string } {
    return { url: this.cortesYouTube.getAuthUrl(orgId) };
  }

  /** "Conectar Instagram" de 1 clique (descobre as contas via Facebook Login). */
  getInstagramAuthUrl(orgId: string): { url: string } {
    return { url: this.cortesInstagram.getAuthUrl(orgId) };
  }
  youtubeChannels(orgId: string) {
    return this.cortesYouTube.listChannels(orgId);
  }
  async youtubeDisconnect(orgId: string, credId: string): Promise<{ ok: true }> {
    await this.cortesYouTube.disconnect(orgId, credId);
    return { ok: true };
  }

  /** Contas conectadas por rede (pro seletor de conta+rede no corte). */
  async listAccounts(orgId: string): Promise<{
    instagram: Array<{ id: string; username: string | null; name: string | null }>;
    tiktok: Array<{ id: string; username: string | null; name: string | null }>;
    youtube: Array<{ id: string; username: string | null; name: string | null }>;
  }> {
    const creds = await this.socialCreds.list(orgId);
    const map = (channel: string) =>
      creds
        .filter((c) => c.channel === channel && c.is_active)
        .map((c) => ({ id: c.id, username: c.external_username, name: c.external_account_name }));
    const ytChannels = await this.cortesYouTube.listChannels(orgId);
    const youtube = ytChannels.map((c) => ({
      id: c.id,
      username: c.title,
      name: 'YouTube',
    }));
    return {
      instagram: map('instagram_business'),
      tiktok: map('tiktok_business'),
      youtube,
    };
  }

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

  // ── Ponte HeyGen → Cortes ─────────────────────────────────

  /**
   * Cria um job de corte a partir de um vídeo já gerado no HeyGen. A URL do mp4
   * do HeyGen vai DIRETO pro Vizard (fonte remota, sem Drive). Idempotente: se o
   * job HeyGen já originou um corte (cortes_job_id), devolve o existente em vez
   * de cortar (= gastar crédito) de novo. Chamado pelo botão manual e pela
   * automação (bridge worker).
   */
  async createJobFromHeyGen(orgId: string, heygenJobId: string): Promise<ContentJob> {
    const { data } = await this.supabase.adminClient
      .from('heygen_jobs')
      .select('id, status, video_url, title, cortes_job_id')
      .eq('id', heygenJobId)
      .eq('org_id', orgId)
      .maybeSingle();
    const hg = data as {
      id: string;
      status: string;
      video_url: string | null;
      title: string | null;
      cortes_job_id: string | null;
    } | null;
    if (!hg) throw new NotFoundException('Vídeo HeyGen não encontrado.');
    if (hg.status !== 'completed' || !hg.video_url) {
      throw new BadRequestException('O vídeo do HeyGen ainda não está pronto pra cortar.');
    }

    // Idempotência: já gerou corte → devolve o mesmo (não corta de novo).
    if (hg.cortes_job_id) {
      const { data: existing } = await this.supabase.adminClient
        .from('content_jobs')
        .select('*')
        .eq('id', hg.cortes_job_id)
        .eq('org_id', orgId)
        .maybeSingle();
      if (existing) return existing as ContentJob;
    }

    const { data: created, error: insErr } = await this.supabase.adminClient
      .from('content_jobs')
      .insert({
        org_id: orgId,
        title: hg.title || 'Vídeo HeyGen',
        source_type: 'heygen' as JobSourceType,
        source_url: hg.video_url,
        heygen_job_id: hg.id,
        status: 'received',
        metadata: { from_heygen: true, heygen_video_url: hg.video_url },
      })
      .select('*')
      .single();
    if (insErr) throw new Error(`Falha ao criar job de corte: ${insErr.message}`);
    const job = created as ContentJob;

    // Carimba o vínculo de volta (rastreio + idempotência do bridge worker).
    await this.supabase.adminClient
      .from('heygen_jobs')
      .update({ cortes_job_id: job.id })
      .eq('id', hg.id)
      .eq('org_id', orgId);

    // Submete o corte async (webhook conclui depois) — não bloqueia a resposta.
    void this.clipping.submit(job).catch((err) => {
      this.log.error(`[heygen→cortes] submit do corte falhou (job ${job.id}): ${String(err)}`);
    });

    this.log.log(`[heygen→cortes] job de corte ${job.id} criado de heygen=${hg.id}`);
    return job;
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
   * Exclui um corte DEFINITIVAMENTE: apaga o arquivo de vídeo do Drive e
   * remove o corte + suas copys (clip_posts cascateia via FK ON DELETE CASCADE).
   * Idempotente no Drive (404 tolerado). NÃO "despublica" o que já foi postado
   * nas redes — isso removeria o post público (ação separada e arriscada); aqui
   * só limpamos o sistema/armazenamento.
   */
  async deleteClip(
    orgId: string,
    clipId: string,
  ): Promise<{ ok: true; drive_deleted: boolean }> {
    const { data: clip } = await this.supabase.adminClient
      .from('clips')
      .select('id, drive_file_id, work_file_deleted_at')
      .eq('id', clipId)
      .eq('org_id', orgId)
      .maybeSingle();
    if (!clip) throw new NotFoundException('Corte não encontrado.');
    const c = clip as {
      id: string;
      drive_file_id: string | null;
      work_file_deleted_at: string | null;
    };

    // 1. Apaga o arquivo de trabalho no Drive (se ainda vivo e Drive conectado).
    //    Não trava a exclusão do registro se o Drive falhar — só logamos, senão
    //    a linha sumiria e o janitor nunca mais acharia o arquivo pra limpar.
    let driveDeleted = false;
    if (c.drive_file_id && !c.work_file_deleted_at) {
      try {
        if (await this.drive.isConfiguredForOrg(orgId)) {
          await this.drive.deleteFile(orgId, c.drive_file_id);
          driveDeleted = true;
        }
      } catch (err) {
        this.log.warn(
          `[delete] Drive file ${c.drive_file_id} (clip ${clipId}): ${String(err)}`,
        );
      }
    }

    // 2. Remove o corte — clip_posts cascateia (FK ON DELETE CASCADE).
    const { error } = await this.supabase.adminClient
      .from('clips')
      .delete()
      .eq('id', clipId)
      .eq('org_id', orgId);
    if (error) throw new Error(error.message);

    this.log.log(`[delete] corte ${clipId} excluído (drive_deleted=${driveDeleted})`);
    return { ok: true, drive_deleted: driveDeleted };
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
      enabled?: boolean;
    },
  ): Promise<unknown> {
    const fields: Record<string, unknown> = {};
    if (patch.title !== undefined) fields.title = patch.title;
    if (patch.copy !== undefined) fields.copy = patch.copy;
    if (patch.hashtags !== undefined) fields.hashtags = patch.hashtags;
    if (patch.scheduled_at !== undefined) fields.scheduled_at = patch.scheduled_at;
    if (patch.account_id !== undefined) fields.account_id = patch.account_id;
    if (patch.enabled !== undefined) fields.enabled = patch.enabled;
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
