import { Controller, Get, Logger, Query, Redirect } from '@nestjs/common';
import { CortesDriveClient } from './cortes-drive.client';

/**
 * Callback do OAuth do Google Drive. SEM AuthGuard (o Google redireciona pra cá
 * sem o JWT do app — a org vem no `state` assinado). Redireciona de volta pro
 * frontend com ?google=connected | error.
 */
@Controller('studio-cortes/google')
export class CortesGoogleOAuthController {
  private readonly log = new Logger(CortesGoogleOAuthController.name);

  constructor(private readonly drive: CortesDriveClient) {}

  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<{ url: string }> {
    const app = (process.env.PUBLIC_APP_URL ?? process.env.FRONTEND_BASE_URL ?? '').replace(/\/$/, '');
    const dest = (q: string) => ({ url: `${app}/social/cortes?${q}` });
    if (error || !code || !state) return dest('google=error');
    try {
      await this.drive.handleCallback(code, state);
      return dest('google=connected');
    } catch (err) {
      this.log.error(`[google/callback] ${String(err)}`);
      return dest('google=error');
    }
  }
}
