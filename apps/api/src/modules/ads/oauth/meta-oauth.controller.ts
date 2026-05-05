import {
  BadRequestException,
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
import { AdIntegrationsService } from '../ad-integrations.service';

/**
 * OAuth fluxo Meta (Facebook/Instagram Ads).
 *
 * Fluxo:
 *   1. Frontend chama GET /ad-integrations/meta/connect (auth required)
 *   2. Backend devolve URL pra dialog Meta. Frontend redireciona usuário.
 *   3. Após consent, Meta redireciona pra GET /ad-integrations/meta/callback
 *      (PÚBLICO — sem JWT, identidade vem do state assinado)
 *   4. Backend troca code por access_token, descobre ad_accounts, persiste,
 *      redireciona o usuário pra /configuracoes > Integrações?status=ok
 *
 * Scopes pedidos:
 *   ads_read              — métricas de campaigns/insights
 *   ads_management        — necessário em algumas regiões pra ler insights
 *   pages_show_list       — listar pages do business
 *   pages_read_engagement — orgânico (Bloco G)
 *   leads_retrieval       — webhook Lead Ads (Bloco F)
 *   business_management   — pra acessar accounts via Business Manager
 *
 * Envs requeridos:
 *   META_APP_ID                  — app id do Meta Developers
 *   META_APP_SECRET              — secret (NUNCA logar)
 *   META_OAUTH_REDIRECT_URI      — default https://active.eclick.app.br/ad-integrations/meta/callback
 *   FRONTEND_BASE_URL            — pra redirect final pós-callback
 */
@Controller('ad-integrations/meta')
export class MetaOAuthController {
  private readonly logger = new Logger(MetaOAuthController.name);

  // Meta Marketing API version
  private readonly API_VERSION = 'v21.0';
  private readonly OAUTH_BASE = `https://www.facebook.com/${this.API_VERSION}/dialog/oauth`;
  private readonly TOKEN_URL = `https://graph.facebook.com/${this.API_VERSION}/oauth/access_token`;
  private readonly GRAPH_URL = `https://graph.facebook.com/${this.API_VERSION}`;

  private readonly SCOPES = [
    'ads_read',
    'ads_management',
    'pages_show_list',
    'pages_read_engagement',
    'leads_retrieval',
    'business_management',
  ].join(',');

  constructor(private readonly integrations: AdIntegrationsService) {}

  // ────────────────────────────────────────────
  // 1) Connect — gera URL pro dialog Meta
  // ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('connect')
  connect(@CurrentUser() user: AuthUser): { url: string } {
    const appId = process.env.META_APP_ID;
    const redirectUri = this.getRedirectUri();
    if (!appId) {
      throw new InternalServerErrorException(
        'META_APP_ID não configurado no servidor.',
      );
    }
    const state = this.integrations.buildOAuthState(user.org_id, user.id, 'meta');
    const params = new URLSearchParams({
      client_id: appId,
      redirect_uri: redirectUri,
      state,
      scope: this.SCOPES,
      response_type: 'code',
    });
    return { url: `${this.OAUTH_BASE}?${params.toString()}` };
  }

  // ────────────────────────────────────────────
  // 2) Callback — Meta redireciona aqui após consent (PÚBLICO)
  // ────────────────────────────────────────────

  @Get('callback')
  async callback(
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const frontend = process.env.FRONTEND_BASE_URL ?? 'https://active.eclick.app.br';

    // User negou ou erro do Meta
    if (error) {
      this.logger.warn(`Meta OAuth callback erro: ${error} — ${errorDescription}`);
      const msg = encodeURIComponent(errorDescription ?? error);
      res.redirect(`${frontend}/configuracoes?ads_error=${msg}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('code/state ausentes no callback');
    }

    const stateData = this.integrations.parseOAuthState(state);
    if (stateData.platform !== 'meta') {
      throw new BadRequestException('OAuth state pertence a outra plataforma');
    }

    try {
      // 2.1) Troca code por short-lived access_token
      const shortToken = await this.exchangeCodeForToken(code);

      // 2.2) Estende pra long-lived (60 dias). Se falhar, segue com short-lived.
      const longLived = await this.extendToLongLived(shortToken.access_token).catch(
        (err) => {
          this.logger.warn(
            `Long-lived exchange falhou (mantendo short-lived): ${err instanceof Error ? err.message : String(err)}`,
          );
          return null;
        },
      );

      const accessToken = longLived?.access_token ?? shortToken.access_token;
      const expiresIn = longLived?.expires_in ?? shortToken.expires_in;
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000) : null;

      // 2.3) Lista ad accounts do user
      const accounts = await this.fetchAdAccounts(accessToken);
      if (accounts.length === 0) {
        res.redirect(
          `${frontend}/configuracoes?ads_error=${encodeURIComponent('Nenhuma ad account encontrada nesta conta Meta.')}`,
        );
        return;
      }

      // 2.4) Persiste TODAS as ad accounts (user pode ter várias)
      for (const acc of accounts) {
        await this.integrations.upsertIntegration({
          orgId: stateData.org_id,
          platform: 'meta',
          adAccountId: acc.id,
          accountName: acc.name,
          accessToken,
          refreshToken: null, // Meta não usa refresh_token; long-lived expira em 60d
          expiresAt,
          scope: this.SCOPES,
          metadata: {
            currency: acc.currency,
            account_status: acc.account_status,
            business: acc.business,
          },
        });
      }

      this.logger.log(
        `Meta OAuth ok — org=${stateData.org_id} accounts=${accounts.length}`,
      );
      res.redirect(`${frontend}/configuracoes?ads_ok=meta&accounts=${accounts.length}`);
    } catch (err) {
      this.logger.error(
        `Meta OAuth callback falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      const msg = encodeURIComponent(
        err instanceof Error ? err.message : 'Erro ao conectar Meta Ads.',
      );
      res.redirect(`${frontend}/configuracoes?ads_error=${msg}`);
    }
  }

  // ────────────────────────────────────────────
  // Helpers — Graph API calls
  // ────────────────────────────────────────────

  private async exchangeCodeForToken(code: string): Promise<{
    access_token: string;
    expires_in: number;
  }> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) {
      throw new InternalServerErrorException(
        'META_APP_ID ou META_APP_SECRET ausentes no servidor.',
      );
    }
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      redirect_uri: this.getRedirectUri(),
      code,
    });
    const url = `${this.TOKEN_URL}?${params.toString()}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta token exchange ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      token_type?: string;
    };
    if (!json.access_token) throw new Error('Meta não devolveu access_token');
    return {
      access_token: json.access_token,
      expires_in: json.expires_in ?? 0,
    };
  }

  private async extendToLongLived(shortToken: string): Promise<{
    access_token: string;
    expires_in: number;
  }> {
    const appId = process.env.META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;
    if (!appId || !appSecret) throw new Error('META envs ausentes');
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortToken,
    });
    const res = await fetch(`${this.TOKEN_URL}?${params.toString()}`);
    if (!res.ok) {
      throw new Error(`Long-lived exchange ${res.status}`);
    }
    const json = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!json.access_token) throw new Error('Long-lived sem token');
    return {
      access_token: json.access_token,
      expires_in: json.expires_in ?? 60 * 60 * 24 * 60, // 60 dias default
    };
  }

  private async fetchAdAccounts(accessToken: string): Promise<
    Array<{
      id: string;
      name: string | null;
      currency: string | null;
      account_status: number | null;
      business: { id: string; name: string } | null;
    }>
  > {
    const fields = 'id,name,currency,account_status,business{id,name}';
    const url = `${this.GRAPH_URL}/me/adaccounts?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(accessToken)}&limit=100`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta adaccounts ${res.status}: ${body.slice(0, 300)}`);
    }
    const json = (await res.json()) as {
      data?: Array<{
        id: string;
        name?: string;
        currency?: string;
        account_status?: number;
        business?: { id: string; name: string };
      }>;
    };
    return (json.data ?? []).map((a) => ({
      id: a.id,
      name: a.name ?? null,
      currency: a.currency ?? null,
      account_status: a.account_status ?? null,
      business: a.business ?? null,
    }));
  }

  private getRedirectUri(): string {
    return (
      process.env.META_OAUTH_REDIRECT_URI ??
      'https://active.eclick.app.br/ad-integrations/meta/callback'
    );
  }
}
