import { Controller, Get, Logger, Query, Redirect } from '@nestjs/common';
import { CortesYouTubeService } from './cortes-youtube.service';

/**
 * Callback do OAuth de canal do YouTube. SEM AuthGuard (Google redireciona sem
 * JWT; a org vem no state assinado). Redireciona pro front com ?youtube=connected|error.
 */
@Controller('studio-cortes/youtube')
export class CortesYouTubeOAuthController {
  private readonly log = new Logger(CortesYouTubeOAuthController.name);

  constructor(private readonly youtube: CortesYouTubeService) {}

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
    if (error || !code || !state) return dest('youtube=error');
    try {
      await this.youtube.handleCallback(code, state);
      return dest('youtube=connected');
    } catch (err) {
      this.log.error(`[youtube/callback] ${String(err)}`);
      return dest('youtube=error');
    }
  }
}
