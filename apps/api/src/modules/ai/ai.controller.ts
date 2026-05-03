import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { AiService } from './ai.service';
import { FeedbackDto } from './dto/feedback.dto';
import { FillFieldDto } from './dto/fill-field.dto';
import type {
  ClassificationResult,
  DealScoreResult,
  FunnelAnalysisResult,
  GapsResult,
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
  summarize(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<{ summary: string; ai_interaction_id: string | null }> {
    return this.service.summarizeConversation(user.org_id, conversationId);
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

  // ──────────────────────────────────────────────────────────
  // Feedback do usuário em respostas de IA (👍 / 👎)
  // ──────────────────────────────────────────────────────────

  // PATCH /ai/interactions/:id/feedback
  @Patch('interactions/:id/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  async feedback(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: FeedbackDto,
  ): Promise<void> {
    await this.service.submitInteractionFeedback(
      user.org_id,
      id,
      dto.feedback,
      dto.comment ?? null,
    );
  }

  // POST /ai/fill-field — gera conteúdo pra um campo de texto
  @Post('fill-field')
  @HttpCode(HttpStatus.OK)
  fillField(
    @CurrentUser() user: AuthUser,
    @Body() dto: FillFieldDto,
  ): Promise<{ value: string; ai_interaction_id: string | null }> {
    return this.service.fillField({
      orgId: user.org_id,
      entityType: dto.entity_type,
      entityId: dto.entity_id,
      fieldName: dto.field_name,
      ...(dto.current_value !== undefined ? { currentValue: dto.current_value } : {}),
      ...(dto.hint !== undefined ? { hint: dto.hint } : {}),
    });
  }

  // ──────────────────────────────────────────────────────────
  // Gaps & perguntas sem resposta (PARTE 6)
  // ──────────────────────────────────────────────────────────

  // GET /ai/unanswered/:conversationId
  @Get('unanswered/:conversationId')
  unanswered(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<
    Array<{
      message_id: string;
      created_at: string;
      text: string;
      is_question: boolean;
    }>
  > {
    return this.service.getUnansweredQuestions(user.org_id, conversationId);
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/gaps/:conversationId — Melhoria 7 (IA-powered, cache 5min)
  // ──────────────────────────────────────────────────────────

  @Get('gaps/:conversationId')
  gaps(
    @CurrentUser() user: AuthUser,
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
  ): Promise<GapsResult> {
    return this.service.detectGaps(user.org_id, conversationId);
  }

  // ──────────────────────────────────────────────────────────
  // GET /ai/feedback/stats — agregação pra Relatórios (Melhoria 6)
  // ──────────────────────────────────────────────────────────

  @Get('feedback/stats')
  feedbackStats(
    @CurrentUser() user: AuthUser,
    @Query('period_days') periodDays?: string,
  ): Promise<{
    total_positive: number;
    total_negative: number;
    approval_rate: number;
    recent_negative_comments: Array<{ comment: string; at: string }>;
    weekly: Array<{ week_start: string; positive: number; negative: number; approval_rate: number }>;
  }> {
    const days = periodDays ? Math.min(365, Math.max(1, Number(periodDays))) : 30;
    return this.service.getFeedbackStats(user.org_id, days);
  }
}
