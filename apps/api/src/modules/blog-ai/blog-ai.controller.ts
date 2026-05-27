import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { BlogAiService } from './blog-ai.service';
import { BlogStudioService, type BlogPromptKey } from './blog-studio.service';
import { BLOG_FONTS } from './blog-fonts';
import type { GenerateBlogPostDto, IdeateDto } from './blog-ai.types';

@UseGuards(AuthGuard)
@Controller('blog-ai')
export class BlogAiController {
  constructor(
    private readonly svc: BlogAiService,
    private readonly studio: BlogStudioService,
  ) {}

  /** Voz da marca (tom/diretrizes editoriais) injetada nos prompts de geração. */
  @Get('settings')
  getSettings(@CurrentUser() user: AuthUser) {
    return this.svc.getSettings(user.org_id);
  }

  @Put('settings')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Body() body: { voice_guidelines?: string | null; display_font?: string | null },
  ) {
    return this.svc.updateSettings(user.org_id, body);
  }

  /** Catálogo de fontes de título disponíveis (slug + label + família p/ preview). */
  @Get('fonts')
  fonts() {
    return BLOG_FONTS;
  }

  // ── Estúdio do Blog: prompts editáveis ───────────────────────────────

  /** Lista os system prompts (article/ideate) — override ou default do código. */
  @Get('studio/prompts')
  listPrompts(@CurrentUser() user: AuthUser) {
    return this.studio.listPrompts(user.org_id);
  }

  @Put('studio/prompts/:key')
  upsertPrompt(@CurrentUser() user: AuthUser, @Param('key') key: BlogPromptKey, @Body() body: { prompt: string }) {
    return this.studio.upsertPrompt(user.org_id, key, body?.prompt);
  }

  /** Reset → volta pro default do código. */
  @Delete('studio/prompts/:key')
  resetPrompt(@CurrentUser() user: AuthUser, @Param('key') key: BlogPromptKey) {
    return this.studio.resetPrompt(user.org_id, key);
  }

  /** ✨ IA reescreve/melhora um system prompt a partir da intenção do usuário. */
  @Post('studio/prompts/:key/generate')
  generatePrompt(
    @CurrentUser() user: AuthUser,
    @Param('key') key: BlogPromptKey,
    @Body() body: { instruction: string; current_prompt?: string },
  ) {
    return this.studio.generatePrompt(user.org_id, { key, instruction: body?.instruction, current_prompt: body?.current_prompt });
  }

  // ── Estúdio do Blog: base de conhecimento ────────────────────────────

  @Get('studio/knowledge')
  listKnowledge(@CurrentUser() user: AuthUser) {
    return this.studio.listKnowledge(user.org_id);
  }

  @Post('studio/knowledge')
  addKnowledge(
    @CurrentUser() user: AuthUser,
    @Body() body: { source_type: 'url' | 'text' | 'image'; value: string; title?: string },
  ) {
    return this.studio.addKnowledge(user.org_id, body);
  }

  @Delete('studio/knowledge/:id')
  removeKnowledge(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.studio.removeKnowledge(user.org_id, id);
  }

  /** IA sugere N pautas (ancoradas nos pilares + GEO + lacunas). */
  @Post('ideate')
  ideate(@CurrentUser() user: AuthUser, @Body() dto: IdeateDto) {
    return this.svc.ideate(user.org_id, dto);
  }

  /** Lote/autopilot: IA sugere N pautas e gera os N artigos (fila de revisão). */
  @Post('generate-batch')
  generateBatch(@CurrentUser() user: AuthUser, @Body() dto: IdeateDto) {
    return this.svc.generateBatch(user.org_id, user.id, dto);
  }

  /** Gera um artigo GEO-otimizado + capa por IA → fila de revisão. */
  @Post('generate')
  generate(@CurrentUser() user: AuthUser, @Body() dto: GenerateBlogPostDto) {
    return this.svc.generateArticle(user.org_id, user.id, dto);
  }

  /** Lista posts do pipeline (filtra por status opcional). */
  @Get('posts')
  list(@CurrentUser() user: AuthUser, @Query('status') status?: string) {
    return this.svc.list(user.org_id, status);
  }

  @Get('posts/:id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.get(user.org_id, id);
  }

  /** Publica no Sanity (vai pro ar em eclick.app.br/blog). */
  @Post('posts/:id/publish')
  publish(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.publish(user.org_id, id);
  }

  /** Rejeita/arquiva um rascunho. */
  @Post('posts/:id/reject')
  reject(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.svc.reject(user.org_id, id, body?.reason);
  }

  /** Agenda a publicação para uma data/hora (ISO). O worker publica no horário. */
  @Post('posts/:id/schedule')
  schedule(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: { scheduled_for: string }) {
    return this.svc.schedule(user.org_id, id, body?.scheduled_for);
  }

  /** Desfaz o agendamento (volta pra revisão). */
  @Post('posts/:id/unschedule')
  unschedule(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.unschedule(user.org_id, id);
  }
}
