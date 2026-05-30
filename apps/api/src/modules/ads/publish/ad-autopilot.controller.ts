import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import {
  AdAutopilotService,
  type AutopilotAction,
  type AutopilotSuggestion,
} from './ad-autopilot.service';

/**
 * Piloto automático: sugestões de otimização (sinais→ações) aplicadas com
 * aprovação. Org-scoped. Nada executa sem o clique do usuário.
 */
@UseGuards(AuthGuard)
@Controller('ad-autopilot')
export class AdAutopilotController {
  constructor(private readonly service: AdAutopilotService) {}

  @Get('suggestions')
  suggestions(@CurrentUser() user: AuthUser): Promise<AutopilotSuggestion[]> {
    return this.service.suggestions(user.org_id);
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser): Promise<unknown[]> {
    return this.service.history(user.org_id);
  }

  @Post('apply')
  apply(
    @CurrentUser() user: AuthUser,
    @Body() dto: { signal_id: string; action: AutopilotAction; pct?: number },
  ) {
    return this.service.apply(user.org_id, user.id, dto);
  }

  @Post('dismiss/:signalId')
  async dismiss(
    @CurrentUser() user: AuthUser,
    @Param('signalId', new ParseUUIDPipe()) signalId: string,
  ): Promise<{ ok: true }> {
    await this.service.dismiss(user.org_id, user.id, signalId);
    return { ok: true };
  }
}
