import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CopilotHelpService } from './copilot-help.service';
import type { KbEntry } from './copilot.kb';

interface HelpDto {
  pathname: string;
  question: string;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

interface FeedbackDto {
  pathname: string;
  question: string;
  answer: string;
  rating: 'up' | 'down';
  comment?: string;
}

/**
 * Endpoints do Copiloto Flutuante v1 (modo HELP).
 *
 * Separado do `CopilotController` que faz tool-use. Os endpoints aqui são:
 *   GET  /copilot/route-context?pathname=
 *   POST /copilot/help                 { pathname, question, history? }
 *   GET  /copilot/kb
 *   POST /copilot/feedback             { pathname, question, answer, rating, comment? }
 *
 * Não conflita com `/copilot/message` e `/copilot/history` — Nest aceita
 * múltiplos controllers no mesmo prefix se as rotas não colidem.
 */
@UseGuards(AuthGuard)
@Controller('copilot')
export class CopilotHelpController {
  constructor(private readonly help: CopilotHelpService) {}

  @Get('route-context')
  routeContext(
    @Query('pathname') pathname: string,
  ): { entries: KbEntry[]; total_kb_size: number } {
    return this.help.getRouteContext(pathname || '/');
  }

  @Post('help')
  @HttpCode(HttpStatus.OK)
  ask(
    @CurrentUser() user: AuthUser,
    @Body() dto: HelpDto,
  ): Promise<{ answer: string; matched_kb: number; cost_usd: number }> {
    return this.help.chat({
      orgId: user.org_id,
      userId: user.id,
      pathname: dto.pathname,
      question: dto.question,
      ...(dto.history ? { history: dto.history } : {}),
    });
  }

  @Get('kb')
  kb(): Record<string, KbEntry[]> {
    return this.help.listKbByCategory();
  }

  @Post('feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  async feedback(
    @CurrentUser() user: AuthUser,
    @Body() dto: FeedbackDto,
  ): Promise<void> {
    await this.help.recordFeedback({
      orgId: user.org_id,
      userId: user.id,
      pathname: dto.pathname,
      question: dto.question,
      answer: dto.answer,
      rating: dto.rating,
      ...(dto.comment ? { comment: dto.comment } : {}),
    });
  }
}
