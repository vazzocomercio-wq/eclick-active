import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SocialIntelligenceService, type TodaysPlan } from './social-intelligence.service';

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
}
