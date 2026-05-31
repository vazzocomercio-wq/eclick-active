import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { StudioCortesService, type UploadedMaster } from './studio-cortes.service';
import { StorageJanitorWorker } from './janitor/storage-janitor.worker';
import type { ClipStatus } from './studio-cortes.types';

@UseGuards(AuthGuard)
@Controller('studio-cortes')
export class StudioCortesController {
  constructor(
    private readonly service: StudioCortesService,
    private readonly janitor: StorageJanitorWorker,
  ) {}

  /** Status de configuração (Drive/provedor) — usado pela UI e pelo smoke. */
  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.service.config(user.org_id);
  }

  // ── OAuth Google Drive ────────────────────────────────────

  @Get('google/connect')
  googleConnect(@CurrentUser() user: AuthUser) {
    return this.service.getGoogleAuthUrl(user.org_id);
  }

  @Get('google/status')
  googleStatus(@CurrentUser() user: AuthUser) {
    return this.service.googleStatus(user.org_id);
  }

  @Post('google/disconnect')
  googleDisconnect(@CurrentUser() user: AuthUser) {
    return this.service.googleDisconnect(user.org_id);
  }

  // ── Canais do YouTube (multi-canal, OAuth próprio) ────────

  @Get('youtube/connect')
  youtubeConnect(@CurrentUser() user: AuthUser) {
    return this.service.getYouTubeAuthUrl(user.org_id);
  }

  /** "Conectar Instagram" de 1 clique (Facebook Login). */
  @Get('instagram/connect')
  instagramConnect(@CurrentUser() user: AuthUser) {
    return this.service.getInstagramAuthUrl(user.org_id);
  }

  @Get('youtube/channels')
  youtubeChannels(@CurrentUser() user: AuthUser) {
    return this.service.youtubeChannels(user.org_id);
  }

  @Post('youtube/disconnect/:credId')
  youtubeDisconnect(@CurrentUser() user: AuthUser, @Param('credId', ParseUUIDPipe) credId: string) {
    return this.service.youtubeDisconnect(user.org_id, credId);
  }

  // ── Upload ────────────────────────────────────────────────

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: UploadedMaster | undefined,
    @Body() body: { title?: string },
  ) {
    if (!file) throw new BadRequestException('Envie o vídeo no campo "file".');
    return this.service.createUploadJob(user.org_id, user.id, file, body?.title);
  }

  // ── Leitura ───────────────────────────────────────────────

  @Get('jobs')
  listJobs(@CurrentUser() user: AuthUser) {
    return this.service.listJobs(user.org_id);
  }

  @Get('board')
  board(@CurrentUser() user: AuthUser) {
    return this.service.getBoard(user.org_id);
  }

  /** Contas conectadas por rede (seletor de conta+rede). */
  @Get('accounts')
  accounts(@CurrentUser() user: AuthUser) {
    return this.service.listAccounts(user.org_id);
  }

  // ── Mutação ───────────────────────────────────────────────

  @Patch('clips/:id/status')
  setClipStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { status: ClipStatus },
  ) {
    return this.service.setClipStatus(user.org_id, id, body.status);
  }

  /** Exclui o corte DEFINITIVAMENTE (apaga vídeo do Drive + registros). */
  @Delete('clips/:id')
  deleteClip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.deleteClip(user.org_id, id);
  }

  /** Agenda/desagenda a publicação do corte (scheduled_at null = desagenda). */
  @Patch('clips/:id/schedule')
  scheduleClip(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { scheduled_at: string | null },
  ) {
    return this.service.scheduleClip(user.org_id, id, body.scheduled_at ?? null);
  }

  @Patch('posts/:id')
  updatePost(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      title?: string | null;
      copy?: string | null;
      hashtags?: string[];
      scheduled_at?: string | null;
      account_id?: string | null;
      enabled?: boolean;
    },
  ) {
    return this.service.updateClipPost(user.org_id, id, body);
  }

  @Patch('jobs/:id')
  updateJob(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { auto_approve?: boolean; title?: string },
  ) {
    return this.service.updateJob(user.org_id, id, body);
  }

  @Post('jobs/:id/regenerate-copy')
  regenerateCopy(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.regenerateCopy(user.org_id, id);
  }

  /** Reenvia o job ao provedor de corte (reusa o master) — pra jobs presos/falhos. */
  @Post('jobs/:id/retry-clip')
  retryClip(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.retryClip(user.org_id, id);
  }

  /** Roda o Janitor manualmente pra org do usuário (smoke / on-demand). */
  @Post('janitor/run')
  runJanitor(@CurrentUser() user: AuthUser) {
    return this.janitor.runForOrg(user.org_id);
  }

  // ── Métricas (Sprint 2) ───────────────────────────────────

  @Get('metrics')
  metrics(@CurrentUser() user: AuthUser) {
    return this.service.metricsSummary(user.org_id);
  }

  @Post('metrics/refresh')
  refreshMetrics(@CurrentUser() user: AuthUser) {
    return this.service.refreshMetrics(user.org_id);
  }
}
