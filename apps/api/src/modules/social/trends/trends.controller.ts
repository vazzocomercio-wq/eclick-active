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
import type {
  CreateMonitorDto,
  TrendBrief,
  TrendItem,
  TrendItemKind,
  TrendMonitor,
  TrendNetwork,
  TrendSignal,
  TrendsOverview,
  UpdateMonitorDto,
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

  /** TR-3 — gera sinais + pautas (IA) cruzando tendências × engajamento × comércio. */
  @Post('generate')
  generate(@CurrentUser() user: AuthUser): Promise<{ signals: number; briefs: number }> {
    return this.briefs.generate(user.org_id);
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
}
