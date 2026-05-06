import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { SocialBrandsService } from './social-brands.service';
import { SocialCalendarsService } from './social-calendars.service';
import { SocialContentsService } from './social-contents.service';
import { SocialAiGeneratorService } from './social-ai/social-ai-generator.service';
import { SocialExportService } from './social-export.service';
import { SocialChannelCredentialsService } from './publishing/social-channel-credentials.service';
import { SocialPublishingService } from './publishing/social-publishing.service';
import { SocialMetricsService } from './analytics/social-metrics.service';
import { SocialSignalsService } from './analytics/social-signals.service';
import { SocialAdBoostService } from './boost/social-ad-boost.service';
import { SocialHashtagsService } from './analytics/social-hashtags.service';
import type { PublishingChannel } from './publishing/publishing.types';
import type { BoostStatus, SocialAdBoostDraft } from './boost/social-ad-boost.types';
import type { CreateBrandDto, UpdateBrandDto } from './dto/brand.dto';
import type {
  CreateCalendarDto,
  UpdateCalendarDto,
  GenerateCalendarDto,
} from './dto/calendar.dto';
import type {
  CreateContentDto,
  UpdateContentDto,
  GeneratePostDto,
  GenerateCarouselDto,
  ScheduleContentDto,
  RejectContentDto,
  RegenerateContentDto,
} from './dto/content.dto';
import type { ContentStatus, ContentType } from './social.types';

@UseGuards(AuthGuard)
@Controller('social')
export class SocialController {
  constructor(
    private readonly brands: SocialBrandsService,
    private readonly calendars: SocialCalendarsService,
    private readonly contents: SocialContentsService,
    private readonly ai: SocialAiGeneratorService,
    private readonly exporter: SocialExportService,
    private readonly creds: SocialChannelCredentialsService,
    private readonly publishing: SocialPublishingService,
    private readonly metrics: SocialMetricsService,
    private readonly signals: SocialSignalsService,
    private readonly boost: SocialAdBoostService,
    private readonly hashtags: SocialHashtagsService,
  ) {}

  // ─── Brands ─────────────────────────────────────

  @Get('brands')
  listBrands(@CurrentUser() user: AuthUser) {
    return this.brands.findAll(user.org_id);
  }

  @Post('brands')
  createBrand(@CurrentUser() user: AuthUser, @Body() dto: CreateBrandDto) {
    return this.brands.create(user.org_id, dto);
  }

  @Get('brands/:id')
  getBrand(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.findById(user.org_id, id);
  }

  @Patch('brands/:id')
  updateBrand(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateBrandDto,
  ) {
    return this.brands.update(user.org_id, id, dto);
  }

  @Delete('brands/:id')
  deleteBrand(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.delete(user.org_id, id);
  }

  @Get('brands/:id/context')
  getBrandContext(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.getContext(user.org_id, id);
  }

  @Post('brands/:id/sync-persona')
  syncBrandPersona(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.brands.syncFromPersona(user.org_id, id);
  }

  // ─── Calendars ──────────────────────────────────

  @Get('calendars')
  listCalendars(
    @CurrentUser() user: AuthUser,
    @Query('brand_id') brandId?: string,
    @Query('status') status?: string,
  ) {
    return this.calendars.findAll(user.org_id, { brand_id: brandId, status });
  }

  @Post('calendars')
  createCalendar(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateCalendarDto,
  ) {
    return this.calendars.create(user.org_id, dto);
  }

  @Post('calendars/generate')
  generateCalendar(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateCalendarDto,
  ) {
    return this.ai.generateCalendar(user.org_id, dto);
  }

  @Get('calendars/:id')
  getCalendar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendars.findById(user.org_id, id);
  }

  @Patch('calendars/:id')
  updateCalendar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateCalendarDto,
  ) {
    return this.calendars.update(user.org_id, id, dto);
  }

  @Delete('calendars/:id')
  deleteCalendar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.calendars.delete(user.org_id, id);
  }

  // ─── Contents ───────────────────────────────────

  @Get('contents')
  listContents(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('content_type') contentType?: string,
    @Query('brand_id') brandId?: string,
    @Query('calendar_id') calendarId?: string,
    @Query('pillar') pillar?: string,
    @Query('search') search?: string,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page?: number,
    @Query('page_size', new DefaultValuePipe(25), ParseIntPipe) pageSize?: number,
  ) {
    return this.contents.findAll(user.org_id, {
      status: status ? (status.split(',') as ContentStatus[]) : undefined,
      content_type: contentType,
      brand_id: brandId,
      calendar_id: calendarId,
      pillar,
      search,
      page,
      page_size: pageSize,
    });
  }

  @Post('contents')
  createContent(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateContentDto,
  ) {
    return this.contents.create(user.org_id, dto);
  }

  @Get('contents/dashboard')
  dashboard(@CurrentUser() user: AuthUser) {
    return this.contents.getDashboard(user.org_id);
  }

  @Get('contents/:id')
  getContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.findById(user.org_id, id);
  }

  @Get('contents/:id/versions')
  getVersions(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.findVersions(user.org_id, id);
  }

  @Patch('contents/:id')
  updateContent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateContentDto,
  ) {
    return this.contents.update(user.org_id, id, dto);
  }

  @Delete('contents/:id')
  deleteContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.delete(user.org_id, id);
  }

  @Post('contents/:id/approve')
  approveContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.approve(user.org_id, id, user.id);
  }

  @Post('contents/:id/reject')
  rejectContent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RejectContentDto,
  ) {
    return this.contents.reject(user.org_id, id, dto);
  }

  @Post('contents/:id/schedule')
  scheduleContent(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: ScheduleContentDto,
  ) {
    return this.contents.schedule(user.org_id, id, dto);
  }

  @Post('contents/:id/unschedule')
  unscheduleContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.unschedule(user.org_id, id);
  }

  @Post('contents/:id/duplicate')
  duplicateContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.contents.duplicate(user.org_id, id);
  }

  @Post('contents/:id/export')
  exportContent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.exporter.exportContent(user.org_id, id);
  }

  // ─── AI generation ──────────────────────────────

  @Post('contents/:id/generate')
  async generateForExisting(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    const content = await this.contents.findById(user.org_id, id);
    return content.content_type === 'carousel'
      ? this.ai.generateCarousel(user.org_id, id)
      : this.ai.generatePost(user.org_id, id);
  }

  @Post('contents/:id/regenerate')
  regenerate(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: RegenerateContentDto,
  ) {
    return this.ai.regenerate(user.org_id, id, dto);
  }

  @Post('contents/:id/rewrite-caption')
  rewriteCaption(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { instruction?: string },
  ) {
    return this.ai.rewriteCaption(user.org_id, id, body.instruction ?? '');
  }

  @Post('contents/:id/suggest-improvements')
  suggestImprovements(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.ai.suggestImprovements(user.org_id, id);
  }

  @Post('generate/post')
  generatePostQuick(
    @CurrentUser() user: AuthUser,
    @Body() dto: GeneratePostDto,
  ) {
    return this.ai.createAndGeneratePost(user.org_id, dto);
  }

  @Post('generate/carousel')
  generateCarouselQuick(
    @CurrentUser() user: AuthUser,
    @Body() dto: GenerateCarouselDto,
  ) {
    return this.ai.createAndGenerateCarousel(user.org_id, dto);
  }

  // ─── Publishing — credentials ───────────────────

  @Get('credentials')
  listCreds(@CurrentUser() user: AuthUser) {
    return this.creds.list(user.org_id);
  }

  @Post('credentials')
  saveCred(
    @CurrentUser() user: AuthUser,
    @Body()
    dto: {
      channel: PublishingChannel;
      brand_id?: string;
      external_account_id: string;
      external_username?: string;
      external_account_name?: string;
      access_token: string;
      refresh_token?: string;
      expires_at?: string;
      scopes?: string[];
      metadata?: Record<string, unknown>;
    },
  ) {
    return this.creds.saveCredential(user.org_id, dto);
  }

  @Delete('credentials/:id')
  deleteCred(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.creds.delete(user.org_id, id);
  }

  @Post('credentials/:id/deactivate')
  deactivateCred(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.creds.deactivate(user.org_id, id);
  }

  // ─── Publishing — publish actions ────────────────

  @Post('contents/:id/publish-now')
  publishNow(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.publishing.publishContent(user.org_id, id);
  }

  @Get('contents/:id/publish-attempts')
  publishAttempts(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.publishing.listAttempts(user.org_id, id);
  }

  // ─── Analytics — reports ─────────────────────────

  @Get('reports/summary')
  reportSummary(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days?: number,
    @Query('brand_id') brandId?: string,
  ) {
    return this.metrics.getSummary(user.org_id, days ?? 30, brandId);
  }

  @Get('reports/by-pillar')
  reportByPillar(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days?: number,
    @Query('brand_id') brandId?: string,
  ) {
    return this.metrics.getByPillar(user.org_id, days ?? 30, brandId);
  }

  @Get('reports/by-hour')
  reportByHour(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days?: number,
    @Query('brand_id') brandId?: string,
  ) {
    return this.metrics.getByHour(user.org_id, days ?? 30, brandId);
  }

  @Get('reports/top-performers')
  reportTopPerformers(
    @CurrentUser() user: AuthUser,
    @Query('days', new DefaultValuePipe(30), ParseIntPipe) days?: number,
    @Query('brand_id') brandId?: string,
    @Query('limit', new DefaultValuePipe(10), ParseIntPipe) limit?: number,
  ) {
    return this.metrics.getTopPerformers(user.org_id, days ?? 30, brandId, limit ?? 10);
  }

  @Get('contents/:id/metrics')
  contentMetrics(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.metrics.getMetricsForContent(user.org_id, id);
  }

  // ─── Hashtag analytics ──────────────────────────

  @Get('hashtags/top')
  hashtagsTop(
    @CurrentUser() user: AuthUser,
    @Query('brand_id') brandId?: string,
    @Query('days', new DefaultValuePipe(60), ParseIntPipe) days?: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit?: number,
  ) {
    return this.hashtags.top(user.org_id, {
      brand_id: brandId,
      days: days ?? 60,
      limit: limit ?? 20,
    });
  }

  @Get('hashtags/detail/:hashtag')
  hashtagsDetail(
    @CurrentUser() user: AuthUser,
    @Param('hashtag') hashtag: string,
    @Query('brand_id') brandId?: string,
    @Query('days', new DefaultValuePipe(60), ParseIntPipe) days?: number,
  ) {
    return this.hashtags.detail(user.org_id, decodeURIComponent(hashtag), {
      brand_id: brandId,
      days: days ?? 60,
    });
  }

  @Post('hashtags/suggest')
  hashtagsSuggest(
    @CurrentUser() user: AuthUser,
    @Body() body: { theme: string; brand_id: string },
  ) {
    return this.hashtags.suggest(user.org_id, body);
  }

  // ─── Analytics — signals ─────────────────────────

  @Get('signals')
  listSignals(
    @CurrentUser() user: AuthUser,
    @Query('only_unacked') onlyUnacked?: string,
  ) {
    return this.signals.list(user.org_id, onlyUnacked === 'true');
  }

  @Post('signals/:id/acknowledge')
  ackSignal(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.signals.acknowledge(user.org_id, id, user.id);
  }

  // ─── Analytics — manual trigger ──────────────────

  @Post('reports/refresh')
  manualRefresh(@CurrentUser() user: AuthUser) {
    return this.metrics.refreshAllRecent(user.org_id, 30, 100);
  }

  @Post('signals/detect')
  manualDetect(@CurrentUser() user: AuthUser) {
    return this.signals.detectAll(user.org_id);
  }

  // ─── Ad Boost ────────────────────────────────────

  @Get('contents/:id/boost-suggestion')
  boostSuggestion(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boost.suggestBoost(user.org_id, id);
  }

  @Post('contents/:id/boost-draft')
  createBoostDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: { signal_id?: string },
  ) {
    return this.boost.createDraft(user.org_id, id, {
      signal_id: body?.signal_id,
      user_id: user.id,
    });
  }

  @Get('boost-drafts')
  listBoostDrafts(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('content_id') contentId?: string,
  ) {
    return this.boost.listDrafts(user.org_id, {
      status: status as BoostStatus | undefined,
      content_id: contentId,
    });
  }

  @Get('boost-drafts/:id')
  getBoostDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boost.findById(user.org_id, id);
  }

  @Patch('boost-drafts/:id')
  updateBoostDraft(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: Partial<SocialAdBoostDraft>,
  ) {
    return this.boost.updateDraft(user.org_id, id, body);
  }

  @Post('boost-drafts/:id/sent')
  markBoostSent(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boost.markSentToPlatform(user.org_id, id);
  }

  @Delete('boost-drafts/:id')
  deleteBoostDraft(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.boost.deleteDraft(user.org_id, id);
  }

  // Note: assets endpoints (CRUD da biblioteca) ficam pra próxima fase.
  // No MVP, assets são criados implicitamente pela geração de imagens
  // e listados via /contents normais.
}

// Satisfaz import (evita erro de imports não usados em alguns lints).
const _typeRef: ContentType | null = null;
void _typeRef;
