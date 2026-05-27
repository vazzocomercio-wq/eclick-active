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
import { InstagramProvider } from '../../../common/channels/providers/instagram/instagram.provider';
import {
  decodeOAuthState,
  encodeOAuthState,
  encryptToken,
} from '../../calendar-integrations/crypto.helper';

const FB_AUTH = 'https://www.facebook.com/v21.0/dialog/oauth';
const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_manage_messages',
  'pages_manage_metadata',
  'pages_messaging',
  'pages_show_list',
  'business_management',
].join(',');

/**
 * OAuth do Instagram via Facebook Login. O admin clica "Conectar
 * Instagram" → Facebook → escolhe page com IG business → callback
 * cria channel_type='instagram' em active.channels.
 *
 * Endpoints:
 *   GET /channels/instagram/auth     → redireciona pra Facebook OAuth
 *   GET /channels/instagram/callback → recebe code → cria canal
 *
 * Env vars necessárias:
 *   META_APP_ID, META_APP_SECRET — do Facebook Developer Console
 *   API_BASE_URL                 — base do callback (default https://api.active.eclick.app.br)
 *   INSTAGRAM_OAUTH_REDIRECT_URI — override opc; senão deriva de API_BASE_URL + /channels/instagram/callback
 *   ENCRYPTION_KEY                — criptografa page_access_token
 */
@Controller('channels/instagram')
export class InstagramOAuthController {
  private readonly logger = new Logger(InstagramOAuthController.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly instagram: InstagramProvider,
  ) {}

  @UseGuards(AuthGuard)
  @Get('auth')
  authUrl(@CurrentUser() user: AuthUser): { url: string } {
    const clientId = this.requireEnv('META_APP_ID');
    const redirectUri = this.getRedirectUri();
    const state = encodeOAuthState({ org_id: user.org_id, agent_id: user.id });
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: INSTAGRAM_SCOPES,
      state,
    });
    return { url: `${FB_AUTH}?${params.toString()}` };
  }

  /**
   * Callback do Facebook OAuth. Sem AuthGuard (Facebook não manda nosso JWT).
   * State criptografado carrega org_id + user_id pra retomar contexto.
   */
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
      const clientId = this.requireEnv('META_APP_ID');
      const clientSecret = this.requireEnv('META_APP_SECRET');
      const redirectUri = this.getRedirectUri();

      // 1. Code → short-lived token
      const short = await this.instagram.exchangeCodeForToken({
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      });

      // 2. Short-lived → long-lived (60d)
      const long = await this.instagram.exchangeForLongLivedToken({
        short_lived_token: short.access_token,
        client_id: clientId,
        client_secret: clientSecret,
      });

      // 3. Lista pages + IG business accounts
      const pages = await this.instagram.listUserPages(long.access_token);
      const igPages = pages.filter((p) => p.ig_user_id !== null);

      if (igPages.length === 0) {
        res.redirect(
          `${webBase}/configuracoes?channel=error&reason=${encodeURIComponent(
            'Nenhuma page com Instagram Business vinculado. Configure no Meta Business Suite.',
          )}`,
        );
        return;
      }

      // 4. Pra cada IG page, cria/atualiza channel + assina webhook
      let createdCount = 0;
      for (const p of igPages) {
        if (!p.ig_user_id) continue;
        await this.upsertInstagramChannel(decoded.org_id, {
          page_id: p.page_id,
          page_name: p.page_name,
          page_access_token: p.page_access_token,
          ig_user_id: p.ig_user_id,
          ig_username: p.ig_username,
          app_id: clientId,
          token_long_lived_expires_in: long.expires_in,
        });
        await this.instagram.subscribePageToWebhook(p.page_id, p.page_access_token);
        createdCount++;
      }

      res.redirect(
        `${webBase}/configuracoes?channel=success&provider=instagram&count=${createdCount}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'erro desconhecido';
      this.logger.error(`OAuth callback falhou: ${msg}`);
      res.redirect(`${webBase}/configuracoes?channel=error&reason=${encodeURIComponent(msg)}`);
    }
  }

  /**
   * Cria ou atualiza um channel Instagram no banco. Tokens criptografados
   * via ENCRYPTION_KEY. credentials.* expostos no model só pro provider —
   * o frontend nunca recebe os tokens.
   */
  private async upsertInstagramChannel(
    orgId: string,
    args: {
      page_id: string;
      page_name: string;
      page_access_token: string;
      ig_user_id: string;
      ig_username: string | null;
      app_id: string;
      token_long_lived_expires_in: number;
    },
  ): Promise<void> {
    const tokenIssuedAt = new Date().toISOString();
    const encrypted = encryptToken(args.page_access_token);
    if (!encrypted) {
      throw new InternalServerErrorException('Falha ao criptografar token');
    }

    // Verifica se já existe
    const { data: existing } = await this.supabase.adminClient
      .from('channels')
      .select('id')
      .eq('org_id', orgId)
      .eq('channel_type', 'instagram')
      .filter('credentials->>ig_user_id', 'eq', args.ig_user_id)
      .maybeSingle();

    const credentials = {
      page_id: args.page_id,
      ig_user_id: args.ig_user_id,
      page_access_token: encrypted, // CRIPTOGRAFADO
      app_id: args.app_id,
      username: args.ig_username,
      token_issued_at: tokenIssuedAt,
      token_expires_in_seconds: args.token_long_lived_expires_in,
    };

    if ((existing as { id: string } | null)?.id) {
      await this.supabase.adminClient
        .from('channels')
        .update({
          credentials,
          status: 'active',
          name: `Instagram — ${args.ig_username ?? args.page_name}`,
        })
        .eq('id', (existing as { id: string }).id);
    } else {
      await this.supabase.adminClient.from('channels').insert({
        org_id: orgId,
        channel_type: 'instagram',
        provider: 'meta_graph',
        name: `Instagram — ${args.ig_username ?? args.page_name}`,
        credentials,
        status: 'active',
        config: {},
      });
    }
  }

  /**
   * URL do callback do OAuth do Instagram. Deriva de API_BASE_URL (domínio da
   * API) pra NÃO colidir com META_OAUTH_REDIRECT_URI — esse env é usado pelo
   * controller de Meta Ads com um path diferente. Override opcional via
   * INSTAGRAM_OAUTH_REDIRECT_URI. Tem que bater EXATO com a Valid OAuth
   * Redirect URI registrada no app Meta.
   */
  private getRedirectUri(): string {
    const apiBase = (
      process.env.API_BASE_URL ?? 'https://api.active.eclick.app.br'
    ).replace(/\/+$/, '');
    return (
      process.env.INSTAGRAM_OAUTH_REDIRECT_URI ??
      `${apiBase}/channels/instagram/callback`
    );
  }

  private requireEnv(name: string): string {
    const v = process.env[name];
    if (!v) {
      throw new InternalServerErrorException(`Env var ${name} ausente — configure no .env`);
    }
    return v;
  }
}
