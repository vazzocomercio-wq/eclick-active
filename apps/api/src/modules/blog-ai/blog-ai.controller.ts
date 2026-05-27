import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { BlogAiService } from './blog-ai.service';
import type { GenerateBlogPostDto, IdeateDto } from './blog-ai.types';

@UseGuards(AuthGuard)
@Controller('blog-ai')
export class BlogAiController {
  constructor(private readonly svc: BlogAiService) {}

  /** IA sugere N pautas (ancoradas nos pilares + GEO + lacunas). */
  @Post('ideate')
  ideate(@CurrentUser() user: AuthUser, @Body() dto: IdeateDto) {
    return this.svc.ideate(user.org_id, dto);
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
