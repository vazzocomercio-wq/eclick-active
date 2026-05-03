import {
  Controller,
  Get,
  InternalServerErrorException,
  Logger,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../../../common/auth/auth.guard';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthUser } from '../../../common/auth/auth.types';
import { SupabaseService } from '../../../common/supabase/supabase.service';
import { TikTokProvider } from '../../../common/channels/providers/tiktok/tiktok.provider';
import {
  decodeOAuthState,
  encodeOAuthState,
  encryptToken,
} from '../../calendar-integrations/crypto.helper';

@Controller('channels/tiktok')
export class TikTokOAuthController {
  private readonly logger = new Logger(TikTokOAuthController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly tiktok: TikTokProvider,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  authUrl(@CurrentUser() user: AuthUser): { url: string } {
    const clientKey = this.requireEnv('TIKTOK_CLIENT_KEY');
    const redirectUri = this.requireEnv('TIKTOK_REDIRECT_URI');
    const state = encodeOAuthState({ org_id: user.org_id, agent_id: user.id });
    return {
      url: this.tiktok.buildAuthUrl({ client_key: clientKey, redirect_uri: redirectUri, state }),
    };
  }

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDesc: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const webBase = process.env.WEB_BASE_URL ?? 'https://active.eclick.app.br';
    if (error) {
      const reason = errorDesc ?? error;
      res.redirect(`${webBase}/configuracoes?channel=error&reason=${encodeURIComponent(reason)}`);
      return;
    }
    if (!code || !state) {
      res.redirect(`${webBase}/configuracoes?channel=error&reason=missing_code_or_state`);
      return;
    }
    const decoded = decodeOAuthState(state);
    if (!decoded) {
      res.redirect(`${webBase}/configuracoes?channel=error&reason=invalid_state`);
      return;
    }

    try {
      const clientKey = this.requireEnv('TIKTOK_CLIENT_KEY');
      const clientSecret = this.requireEnv('TIKTOK_CLIENT_SECRET');
      const redirectUri = this.requireEnv('TIKTOK_REDIRECT_URI');

      const tokens = await this.tiktok.exchangeCodeForToken({
        code,
        redirect_uri: redirectUri,
        client_key: clientKey,
        client_secret: clientSecret,
      });

      const user = await this.tiktok.fetchUserInfo(tokens.access_token);
      if (!user) {
        throw new Error('Não consegui buscar info do user TikTok');
      }

      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();
      const accessEnc = encryptToken(tokens.access_token);
      const refreshEnc = encryptToken(tokens.refresh_token);
      if (!accessEnc || !refreshEnc) {
        throw new Error('Falha ao criptografar tokens (ENCRYPTION_KEY?)');
      }

      const credentials = {
        open_id: user.open_id,
        access_token_encrypted: accessEnc,
        refresh_token_encrypted: refreshEnc,
        token_expires_at: expiresAt,
        username: user.username,
        display_name: user.display_name,
        avatar_url: user.avatar_url,
      };

      // Upsert
      const { data: existing } = await this.supabase.adminClient
        .from('channels')
        .select('id')
        .eq('org_id', decoded.org_id)
        .eq('channel_type', 'tiktok')
        .filter('credentials->>open_id', 'eq', user.open_id)
        .maybeSingle();

      if ((existing as { id: string } | null)?.id) {
        await this.supabase.adminClient
          .from('channels')
          .update({
            credentials,
            status: 'active',
            name: `TikTok — @${user.username}`,
          })
          .eq('id', (existing as { id: string }).id);
      } else {
        await this.supabase.adminClient.from('channels').insert({
          org_id: decoded.org_id,
          channel_type: 'tiktok',
          provider: 'tiktok_for_developers',
          name: `TikTok — @${user.username}`,
          credentials,
          status: 'active',
          config: {},
        });
      }

      res.redirect(`${webBase}/configuracoes?channel=success&provider=tiktok`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro';
      this.logger.error(`TikTok OAuth callback falhou: ${msg}`);
      res.redirect(`${webBase}/configuracoes?channel=error&reason=${encodeURIComponent(msg)}`);
    }
  }

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) throw new InternalServerErrorException(`Env var ${name} ausente`);
    return v;
  }
}
