import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CalendarIntegrationPublic } from '@eclick-active/shared';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import type { AuthUser } from '../../common/auth/auth.types';
import { CalendarIntegrationsService } from './calendar-integrations.service';
import { GoogleCalendarService } from './google-calendar.service';
import { CalendlyService } from './calendly.service';

@Controller('calendar')
export class CalendarIntegrationsController {
  constructor(
    private readonly integrations: CalendarIntegrationsService,
    private readonly google: GoogleCalendarService,
    private readonly calendly: CalendlyService,
  ) {}

  // ────────────────────────────────────────────
  // OAuth — Google
  // ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('google/auth')
  googleAuthUrl(
    @CurrentUser() user: AuthUser,
    @Query('agent_id') agentIdQuery?: string,
  ): { url: string } {
    // Por padrão, conecta o agente do user logado. Admin pode passar agent_id
    // explícito pra conectar em nome de outro membro.
    const agentId = agentIdQuery || user.id;
    return { url: this.google.getAuthUrl(user.org_id, agentId) };
  }

  /**
   * Callback do OAuth — Google redireciona pra cá com ?code=&state=.
   * Sem AuthGuard porque o Google não manda nosso JWT.
   * Após processar, redireciona pra /configuracoes?calendar=success ou error.
   */
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = process.env.WEB_BASE_URL ?? 'https://active.eclick.app.br';
    if (error) {
      res.redirect(`${webBase}/configuracoes?calendar=error&reason=${encodeURIComponent(error)}`);
      return;
    }
    try {
      await this.google.handleCallback(code, state);
      res.redirect(`${webBase}/configuracoes?calendar=success&provider=google`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      res.redirect(`${webBase}/configuracoes?calendar=error&reason=${encodeURIComponent(msg)}`);
    }
  }

  // ────────────────────────────────────────────
  // OAuth — Calendly
  // ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('calendly/auth')
  calendlyAuthUrl(
    @CurrentUser() user: AuthUser,
    @Query('agent_id') agentIdQuery?: string,
  ): { url: string } {
    const agentId = agentIdQuery || user.id;
    return { url: this.calendly.getAuthUrl(user.org_id, agentId) };
  }

  @Get('calendly/callback')
  async calendlyCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') error: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = process.env.WEB_BASE_URL ?? 'https://active.eclick.app.br';
    if (error) {
      res.redirect(`${webBase}/configuracoes?calendar=error&reason=${encodeURIComponent(error)}`);
      return;
    }
    try {
      await this.calendly.handleCallback(code, state);
      res.redirect(`${webBase}/configuracoes?calendar=success&provider=calendly`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      res.redirect(`${webBase}/configuracoes?calendar=error&reason=${encodeURIComponent(msg)}`);
    }
  }

  @UseGuards(AuthGuard)
  @Get('calendly/event-types/:integrationId')
  async calendlyEventTypes(
    @CurrentUser() user: AuthUser,
    @Param('integrationId', ParseUUIDPipe) integrationId: string,
  ) {
    // Valida ownership
    await this.integrations.findById(user.org_id, integrationId);
    return this.calendly.getEventTypes(integrationId);
  }

  // ────────────────────────────────────────────
  // Webhooks (sem AuthGuard — vêm do provedor externo)
  // ────────────────────────────────────────────

  /**
   * Webhook Calendly — POST /calendar/calendly/webhook
   * Calendly assina com HMAC-SHA256 (header Calendly-Webhook-Signature).
   * Pra v1 aceitamos sem validação de assinatura (TODO: validar com
   * webhook_signing_key de cada subscription).
   */
  @Post('calendly/webhook')
  @HttpCode(HttpStatus.OK)
  async calendlyWebhook(
    @Body() body: Parameters<CalendlyService['handleWebhook']>[0],
  ): Promise<{ ok: true }> {
    await this.calendly.handleWebhook(body);
    return { ok: true };
  }

  /**
   * Webhook Google Calendar — POST /calendar/google/webhook
   * Google manda 200 obrigatório dentro de 30s ou desativa o canal.
   * Headers úteis:
   *   X-Goog-Channel-ID
   *   X-Goog-Resource-ID
   *   X-Goog-Resource-State (sync, exists, not_exists)
   * v1: aceita o ping, marca last_synced_at, deixa o pull pro próximo
   * tick do worker.
   */
  @Post('google/webhook')
  @HttpCode(HttpStatus.OK)
  googleWebhook(
    @Headers('x-goog-channel-id') channelId: string | undefined,
    @Headers('x-goog-resource-state') state: string | undefined,
    @Req() _req: Request,
  ): { ok: true } {
    // Em produção, descobrir integration via channel_id e disparar sync.
    // V1: log e ack.
    return { ok: true };
  }

  // ────────────────────────────────────────────
  // CRUD integrações (auth)
  // ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('integrations')
  list(
    @CurrentUser() user: AuthUser,
    @Query('agent_id') agentId?: string,
  ): Promise<CalendarIntegrationPublic[]> {
    return this.integrations.list(user.org_id, agentId);
  }

  @UseGuards(AuthGuard)
  @Get('integrations/:id')
  findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<CalendarIntegrationPublic> {
    return this.integrations.findById(user.org_id, id);
  }

  @UseGuards(AuthGuard)
  @Patch('integrations/:id')
  updateSettings(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      sync_enabled?: boolean;
      consider_personal_events?: boolean;
      bidirectional_sync?: boolean;
      auto_create_deal?: boolean;
    },
  ): Promise<CalendarIntegrationPublic> {
    return this.integrations.updateSettings(user.org_id, id, body);
  }

  @UseGuards(AuthGuard)
  @Delete('integrations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.integrations.disconnect(user.org_id, id);
  }

  @UseGuards(AuthGuard)
  @Post('integrations/:id/sync')
  @HttpCode(HttpStatus.OK)
  syncNow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<{ ok: true; synced_at: string }> {
    return this.integrations.syncNow(user.org_id, id);
  }
}
