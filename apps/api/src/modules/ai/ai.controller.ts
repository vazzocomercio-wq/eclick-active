import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiService } from './ai.service';
import type {
  ClassificationResult,
  DealScoreResult,
  FunnelAnalysisResult,
  SuggestionResult,
} from './ai.types';

@UseGuards(AuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly service: AiService) {}

  // ──────────────────────────────────────────────────────────
  // Conversation-related (Tarefa 7)
  // ──────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────
  // Deal & funnel (Tarefa 4 do Funil Vivo)
  // ──────────────────────────────────────────────────────────

  // POST /ai/score-deal/:dealId — pontua um deal sob demanda
  @Post('score-deal/:dealId')
  @HttpCode(HttpStatus.OK)
  scoreDeal(
    @CurrentUser() user: AuthUser,
    @Param('dealId', ParseUUIDPipe) dealId: string,
  ): Promise<DealScoreResult> {
    return this.service.scoreDeal(user.org_id, dealId);
  }

  /**
   * POST /ai/score-all?pipeline_id=<uuid>
   *
   * Reavalia score de todos os deals ativos. Filtro opcional por pipeline.
   * Pode ser lento — workers pool concurrency=3. Pra agendar via cron,
   * chame esse endpoint internamente; sob demanda do agente, mostre
   * progresso na UI ou avise antes de disparar.
   */
  @Post('score-all')
  @HttpCode(HttpStatus.OK)
  scoreAll(
    @CurrentUser() user: AuthUser,
    @Query('pipeline_id') pipelineId?: string,
  ): Promise<{ scored: number; failed: number; total: number }> {
    return this.service.scoreAllDeals(user.org_id, pipelineId);
  }

  // POST /ai/analyze-funnel/:pipelineId — gera análise + cacheia em pipelines.settings
  @Post('analyze-funnel/:pipelineId')
  @HttpCode(HttpStatus.OK)
  analyzeFunnel(
    @CurrentUser() user: AuthUser,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
  ): Promise<FunnelAnalysisResult> {
    return this.service.analyzeFunnel(user.org_id, pipelineId);
  }

  // GET /ai/funnel-insights/:pipelineId — leitura do cache (sem custo de IA)
  @Get('funnel-insights/:pipelineId')
  funnelInsights(
    @CurrentUser() user: AuthUser,
    @Param('pipelineId', ParseUUIDPipe) pipelineId: string,
  ): Promise<{
    pipeline_id: string;
    analysis: FunnelAnalysisResult | null;
    generated_at: string | null;
  }> {
    return this.service.getCachedFunnelAnalysis(user.org_id, pipelineId);
  }
}
