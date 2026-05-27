import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SocialIntelligenceService, type TodaysPlan, type WeekPlan, type Recommendation, type AdsSummary, type SentimentSummary } from './social-intelligence.service';

/**
 * E-Click Social Intelligence — "O que postar hoje".
 * GET retorna o plano do dia (cacheado); refresh regera (gasta 1 chamada de IA).
 */
@UseGuards(AuthGuard)
@Controller('social/intelligence')
export class SocialIntelligenceController {
  constructor(private readonly intel: SocialIntelligenceService) {}

  @Get('today')
  today(@CurrentUser() user: AuthUser): Promise<TodaysPlan> {
    return this.intel.getTodaysPlan(user.org_id);
  }

  @Post('today/refresh')
  refresh(@CurrentUser() user: AuthUser): Promise<TodaysPlan> {
    return this.intel.getTodaysPlan(user.org_id, true);
  }

  /** Resumo orgânico pro dashboard executivo (heatmap/trend/top/por formato). */
  @Get('overview')
  overview(@CurrentUser() user: AuthUser) {
    return this.intel.getOverview(user.org_id);
  }

  /** Plano de conteúdo da semana (a IA monta os 7 dias). */
  @Get('week')
  week(@CurrentUser() user: AuthUser): Promise<WeekPlan> {
    return this.intel.getWeekPlan(user.org_id);
  }

  @Post('week/refresh')
  weekRefresh(@CurrentUser() user: AuthUser): Promise<WeekPlan> {
    return this.intel.getWeekPlan(user.org_id, true);
  }

  /** Feed de recomendações acionáveis (determinístico). */
  @Get('recommendations')
  recommendations(@CurrentUser() user: AuthUser): Promise<Recommendation[]> {
    return this.intel.getRecommendations(user.org_id);
  }

  /** Resumo de ADS (Meta/Google) — gasto/CTR/CPM/CAC/ROAS + top campanhas. */
  @Get('ads')
  ads(@CurrentUser() user: AuthUser): Promise<AdsSummary> {
    return this.intel.getAdsSummary(user.org_id);
  }

  /** Sentimento das conversas dos clientes (inbox). */
  @Get('sentiment')
  sentiment(@CurrentUser() user: AuthUser): Promise<SentimentSummary> {
    return this.intel.getSentiment(user.org_id);
  }

  @Post('sentiment/refresh')
  sentimentRefresh(@CurrentUser() user: AuthUser): Promise<SentimentSummary> {
    return this.intel.getSentiment(user.org_id, true);
  }
}
