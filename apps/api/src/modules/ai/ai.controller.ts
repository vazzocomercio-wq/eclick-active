import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiService } from './ai.service';
import type { ClassificationResult, SuggestionResult } from './ai.types';

@UseGuards(AuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  // POST /ai/suggest/:conversationId — gera sugestão sob demanda
  @Post('suggest/:conversationId')
  @HttpCode(HttpStatus.OK)
  suggest(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<SuggestionResult> {
    return this.service.suggestResponse(user.org_id, conversationId);
  }

  // POST /ai/summarize/:conversationId — resume e atualiza ai_summary
  @Post('summarize/:conversationId')
  @HttpCode(HttpStatus.OK)
  async summarize(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ summary: string }> {
    const summary = await this.service.summarizeConversation(user.org_id, conversationId);
    return { summary };
  }

  // GET /ai/classification/:messageId — retorna classificação persistida
  @Get('classification/:messageId')
  classification(
    @CurrentUser() user: AuthUser,
    @Param('messageId', ParseUUIDPipe) messageId: string,
  ): Promise<{
    message_id: string;
    ai_intent: string | null;
    ai_sentiment: string | null;
    classification: ClassificationResult | null;
  }> {
    return this.service.getClassification(user.org_id, messageId);
  }
}
