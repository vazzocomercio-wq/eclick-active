import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { TrendsService } from './trends.service';
import { TrendsCollectorService, type CollectResult } from './trends-collector.service';
import { TrendsBriefService } from './trends-brief.service';
import { ProfilesService } from './profiles.service';
import { ProfileMiningService, type MineResult } from './profile-mining.service';
import { ReverseEngineerService } from './reverse-engineer.service';
import type {
  AnalyzePatternsDto,
  BulkImportProfilesDto,
  CreateMonitorDto,
  CreateProfileDto,
  ProfileNetwork,
  TrendBrief,
  TrendItem,
  TrendItemKind,
  TrendMonitor,
  TrendNetwork,
  TrendPattern,
  TrendProfile,
  TrendSignal,
  TrendsOverview,
  UpdateMonitorDto,
  UpdateProfileDto,
} from './trends.types';

/**
 * Radar de Conteúdo — tendências + dados individuais por item.
 * Fundação (TR-0): CRUD de monitores + leitura de itens/sinais/briefs +
 * overview (estado das fontes). Conectores chegam em TR-1/TR-2/TR-5.
 */
@UseGuards(AuthGuard)
@Controller('social/trends')
export class TrendsController {
  constructor(
    private readonly trends: TrendsService,
    private readonly collector: TrendsCollectorService,
    private readonly briefs: TrendsBriefService,
    private readonly profiles: ProfilesService,
    private readonly mining: ProfileMiningService,
    private readonly reverse: ReverseEngineerService,
  ) {}

  /** Estado do Radar: contadores + catálogo de fontes (live/planejada). */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser): Promise<TrendsOverview> {
    return this.trends.getOverview(user.org_id);
  }

  // ─── Monitores ──────────────────────────────────

  @Get('monitors')
  listMonitors(@CurrentUser() user: AuthUser): Promise<TrendMonitor[]> {
    return this.trends.listMonitors(user.org_id);
  }

  @Post('monitors')
  createMonitor(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMonitorDto,
  ): Promise<TrendMonitor> {
    return this.trends.createMonitor(user.org_id, dto);
  }

  @Patch('monitors/:id')
  updateMonitor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateMonitorDto,
  ): Promise<TrendMonitor> {
    return this.trends.updateMonitor(user.org_id, id, dto);
  }

  @Delete('monitors/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMonitor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.trends.deleteMonitor(user.org_id, id);
  }

  // ─── Coleta (TR-1) ──────────────────────────────

  /** Dispara coleta de TODOS os monitores ativos da org (síncrono). */
  @Post('collect')
  collectAll(@CurrentUser() user: AuthUser): Promise<CollectResult> {
    return this.collector.collectAll(user.org_id);
  }

  /** Dispara coleta de 1 monitor específico. */
  @Post('monitors/:id/collect')
  async collectMonitor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<{ items: number }> {
    const monitor = await this.trends.getMonitor(user.org_id, id);
    const items = await this.collector.collectMonitor(user.org_id, monitor);
    return { items };
  }

  // ─── Itens / Sinais / Briefs ────────────────────

  @Get('items')
  listItems(
    @CurrentUser() user: AuthUser,
    @Query('source') source?: TrendNetwork,
    @Query('category') category?: string,
    @Query('kind') kind?: TrendItemKind,
    @Query('monitor_id') monitorId?: string,
    @Query('limit') limit?: string,
  ): Promise<TrendItem[]> {
    return this.trends.listItems(user.org_id, {
      source,
      category,
      kind,
      monitor_id: monitorId,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('items/:id')
  getItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<TrendItem> {
    return this.trends.getItem(user.org_id, id);
  }

  @Get('signals')
  listSignals(@CurrentUser() user: AuthUser): Promise<TrendSignal[]> {
    return this.trends.listSignals(user.org_id);
  }

  @Get('briefs')
  listBriefs(@CurrentUser() user: AuthUser): Promise<TrendBrief[]> {
    return this.trends.listBriefs(user.org_id);
  }

  /**
   * TR-3 — gera sinais + pautas (IA). `category` escopa só aquele nicho.
   * `target_minutes` dimensiona o roteiro de vídeo longo de YouTube (3/5/8/12…).
   */
  @Post('generate')
  generate(
    @CurrentUser() user: AuthUser,
    @Body() body?: { category?: string; target_minutes?: number },
  ): Promise<{ signals: number; briefs: number }> {
    return this.briefs.generate(user.org_id, body?.category, body?.target_minutes);
  }

  /** Limpa itens coletados (e sinais) por categoria e/ou mais antigos que N dias. */
  @Post('items/clear')
  clearItems(
    @CurrentUser() user: AuthUser,
    @Body() body: { category?: string; older_than_days?: number },
  ): Promise<{ deleted: number }> {
    return this.trends.clearItems(user.org_id, {
      category: body?.category,
      olderThanDays: body?.older_than_days,
    });
  }

  /** Descarta um brief (sai do feed). */
  @Post('briefs/:id/dismiss')
  @HttpCode(HttpStatus.NO_CONTENT)
  async dismissBrief(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.briefs.dismissBrief(user.org_id, id);
  }

  // ─── Pilar 1: Perfis de referência (Inteligência Global) ────────

  @Get('profiles')
  listProfiles(
    @CurrentUser() user: AuthUser,
    @Query('network') network?: ProfileNetwork,
    @Query('category') category?: string,
  ): Promise<TrendProfile[]> {
    return this.profiles.list(user.org_id, { network, category });
  }

  @Post('profiles')
  createProfile(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateProfileDto,
  ): Promise<TrendProfile> {
    return this.profiles.create(user.org_id, dto);
  }

  /** Importa em lote (cola URLs/handles — a "Google Sheets" do método). */
  @Post('profiles/import')
  importProfiles(
    @CurrentUser() user: AuthUser,
    @Body() dto: BulkImportProfilesDto,
  ): Promise<{ imported: number; skipped: number }> {
    return this.profiles.bulkImport(user.org_id, dto);
  }

  @Patch('profiles/:id')
  updateProfile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<TrendProfile> {
    return this.profiles.update(user.org_id, id, dto);
  }

  @Delete('profiles/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteProfile(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.profiles.remove(user.org_id, id);
  }

  /** Minera os perfis ativos AGORA (botão manual ignora a trava de frequência). */
  @Post('profiles/mine')
  mineProfiles(@CurrentUser() user: AuthUser): Promise<MineResult> {
    return this.mining.mineAll(user.org_id, true);
  }

  // ─── Pilar 2: Engenharia reversa (padrões vencedores) ───────────

  @Get('patterns')
  listPatterns(
    @CurrentUser() user: AuthUser,
    @Query('category') category?: string,
  ): Promise<TrendPattern[]> {
    return this.reverse.list(user.org_id, category);
  }

  /** Decompõe os itens vencedores em padrões reutilizáveis (1 chamada IA). */
  @Post('analyze')
  analyze(
    @CurrentUser() user: AuthUser,
    @Body() dto: AnalyzePatternsDto,
  ): Promise<{ patterns: number }> {
    return this.reverse.analyze(user.org_id, dto ?? {});
  }
}
