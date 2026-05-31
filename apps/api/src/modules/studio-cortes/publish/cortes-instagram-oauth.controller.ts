import { Controller, Get, Logger, Query, Redirect } from '@nestjs/common';
import { CortesInstagramService } from './cortes-instagram.service';

/**
 * Callback do OAuth de Instagram (Facebook Login). SEM AuthGuard. Redireciona
 * pro front com ?instagram=connected&count=N | error.
 */
@Controller('studio-cortes/instagram')
export class CortesInstagramOAuthController {
  private readonly log = new Logger(CortesInstagramOAuthController.name);

  constructor(private readonly instagram: CortesInstagramService) {}

  @Get('callback')
  @Redirect()
  async callback(
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ): Promise<{ url: string }> {
    const app = (
      process.env.WEB_BASE_URL ??
      process.env.PUBLIC_APP_URL ??
      process.env.FRONTEND_BASE_URL ??
      'https://active.eclick.app.br'
    ).replace(/\/$/, '');
    const dest = (q: string) => ({ url: `${app}/social/cortes?${q}` });
    if (error || !code || !state) return dest('instagram=error');
    try {
      const r = await this.instagram.handleCallback(code, state);
      return dest(`instagram=connected&count=${r.connected}`);
    } catch (err) {
      this.log.error(`[instagram/callback] ${String(err)}`);
      return dest('instagram=error');
    }
  }
}
