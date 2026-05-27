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
  constructor(private readonly trends: TrendsService) {}

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
}
