import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { HeyGenService } from './heygen.service';
import type { CreateHeyGenJobDto, HeyGenJob, HeyGenOptions } from './heygen.types';

/**
 * HeyGen — gera vídeo com avatar a partir do roteiro de uma pauta do Radar.
 * Gated por HEYGEN_API_KEY (best-effort: options() avisa quando desligado).
 */
@UseGuards(AuthGuard)
@Controller('social/heygen')
export class HeyGenController {
  constructor(private readonly heygen: HeyGenService) {}

  /** Integração ligada? (UI usa pra mostrar/ocultar o botão). */
  @Get('status')
  status(): { configured: boolean } {
    return { configured: this.heygen.isConfigured() };
  }

  /** Catálogo de avatares + vozes pro modal de criação. */
  @Get('options')
  options(): Promise<HeyGenOptions> {
    return this.heygen.options();
  }

  @Get('jobs')
  listJobs(@CurrentUser() user: AuthUser): Promise<HeyGenJob[]> {
    return this.heygen.listJobs(user.org_id);
  }

  /** Lê 1 job (atualiza do HeyGen se ainda em andamento) — alvo do polling. */
  @Get('jobs/:id')
  getJob(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<HeyGenJob> {
    return this.heygen.getJob(user.org_id, id);
  }

  /** Dispara a geração de vídeo (custo $) — só por ação explícita do usuário. */
  @Post('jobs')
  createJob(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateHeyGenJobDto,
  ): Promise<HeyGenJob> {
    return this.heygen.createJob(user.org_id, dto);
  }
}
