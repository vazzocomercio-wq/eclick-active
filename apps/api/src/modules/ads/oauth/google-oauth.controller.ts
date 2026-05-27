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
import { AdsSyncService } from '../ads-sync.service';

/**
 * OAuth fluxo Google Ads (Bloco D).
 *
 * Fluxo:
 *   1. Frontend chama GET /ad-integrations/google/connect (auth)
 *   2. Backend devolve URL pro consent screen Google
 *   3. Após consent, Google redireciona pra GET /ad-integrations/google/callback
 *      (PÚBLICO — identidade do state assinado)
 *   4. Backend troca code por access_token + refresh_token, descobre
 *      customer_ids acessíveis, persiste, redireciona /configuracoes
 *
 * Scope: https://www.googleapis.com/auth/adwords
 *
 * Envs (cole quando dev token aprovar — ~3-7 dias via apicenter):
 *   GOOGLE_ADS_DEVELOPER_TOKEN — header obrigatório em chamadas Ads API
 *   GOOGLE_OAUTH_CLIENT_ID
 *   GOOGLE_OAUTH_CLIENT_SECRET
 *   API_BASE_URL                 — base do callback (default https://api.active.eclick.app.br)
 *   GOOGLE_OAUTH_REDIRECT_URI (opc — override; senão deriva de API_BASE_URL + /ad-integrations/google/callback)
 */
@Controller('ad-integrations/google')
export class GoogleOAuthController {
  private readonly logger = new Logger(GoogleOAuthController.name);

  private readonly OAUTH_BASE = 'https://accounts.google.com/o/oauth2/v2/auth';
  private readonly TOKEN_URL = 'https://oauth2.googleapis.com/token';
  private readonly ADS_API_BASE = 'https://googleads.googleapis.com/v18';

  // Adwords scope dá acesso completo à Ads API. Não tem scope read-only
  // separado oficial pra Ads (só pra Analytics).
  private readonly SCOPES = 'https://www.googleapis.com/auth/adwords';

  constructor(
    private readonly integrations: AdIntegrationsService,
    private readonly sync: AdsSyncService,
  ) {}

  // ────────────────────────────────────────────
  // 1) Connect — gera URL pro consent
  // ────────────────────────────────────────────

  @UseGuards(AuthGuard)
  @Get('connect')
  connect(@CurrentUser() user: AuthUser): { url: string } {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      throw new InternalServerErrorException(
        'GOOGLE_OAUTH_CLIENT_ID não configurado no servidor.',
      );
    }
    const state = this.integrations.buildOAuthState(user.org_id, user.id, 'google');
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.getRedirectUri(),
      response_type: 'code',
      scope: this.SCOPES,
      state,
      // access_type=offline + prompt=consent garante que refresh_token
      // venha mesmo se o user já autorizou o app antes
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
    });
    return { url: `${this.OAUTH_BASE}?${params.toString()}` };
  }

  // ────────────────────────────────────────────
  // 2) Callback — Google redireciona aqui após consent (PÚBLICO)
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

    if (error) {
      this.logger.warn(`Google OAuth callback erro: ${error} — ${errorDescription}`);
      const msg = encodeURIComponent(errorDescription ?? error);
      res.redirect(`${frontend}/configuracoes?ads_error=${msg}`);
      return;
    }
    if (!code || !state) {
      throw new BadRequestException('code/state ausentes no callback');
    }

    const stateData = this.integrations.parseOAuthState(state);
    if (stateData.platform !== 'google') {
      throw new BadRequestException('OAuth state pertence a outra plataforma');
    }

    try {
      // 2.1) Troca code por tokens (access + refresh)
      const tokens = await this.exchangeCodeForTokens(code);

      // 2.2) Lista customers acessíveis
      const customerIds = await this.listAccessibleCustomers(tokens.access_token);
      if (customerIds.length === 0) {
        res.redirect(
          `${frontend}/configuracoes?ads_error=${encodeURIComponent('Nenhuma conta Google Ads encontrada nesta sessão.')}`,
        );
        return;
      }

      // 2.3) Pra cada customer, busca metadata + persiste
      const created: Array<{ id: string; account: string }> = [];
      for (const customerId of customerIds) {
        const meta = await this.fetchCustomerMeta(tokens.access_token, customerId).catch(
          () => ({ name: null, currency: null }),
        );
        const integration = await this.integrations.upsertIntegration({
          orgId: stateData.org_id,
          platform: 'google',
          adAccountId: customerId,
          accountName: meta.name,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt: tokens.expires_in
            ? new Date(Date.now() + tokens.expires_in * 1000)
            : null,
          scope: this.SCOPES,
          metadata: {
            currency: meta.currency,
            customer_id: customerId,
          },
        });
        created.push({ id: integration.id, account: customerId });
      }

      this.logger.log(
        `Google OAuth ok — org=${stateData.org_id} accounts=${customerIds.length}`,
      );

      // 2.4) Backfill 90d em background pra cada integração
      for (const c of created) {
        void this.sync
          .backfillIntegration(c.id, 90)
          .then((r) => {
            this.logger.log(
              `backfill[${c.id}] done campaigns=${r.campaigns_upserted} metrics=${r.metrics_upserted} took=${r.duration_ms}ms`,
            );
          })
          .catch((err) => {
            this.logger.warn(
              `backfill[${c.id}] falhou: ${err instanceof Error ? err.message : String(err)}`,
            );
          });
      }

      res.redirect(`${frontend}/configuracoes?ads_ok=google&accounts=${customerIds.length}`);
    } catch (err) {
      this.logger.error(
        `Google OAuth callback falhou: ${err instanceof Error ? err.message : String(err)}`,
      );
      const msg = encodeURIComponent(
        err instanceof Error ? err.message : 'Erro ao conectar Google Ads.',
      );
      res.redirect(`${frontend}/configuracoes?ads_error=${msg}`);
    }
  }

  // ────────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────────

  private async exchangeCodeForTokens(code: string): Promise<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
  }> {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new InternalServerErrorException(
        'GOOGLE_OAUTH_CLIENT_ID ou GOOGLE_OAUTH_CLIENT_SECRET ausentes.',
      );
    }
    const body = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.getRedirectUri(),
      grant_type: 'authorization_code',
    });
    const res = await fetch(this.TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google token exchange ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      token_type: string;
    };
  }

  private async listAccessibleCustomers(accessToken: string): Promise<string[]> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!devToken) {
      throw new InternalServerErrorException(
        'GOOGLE_ADS_DEVELOPER_TOKEN ausente — solicite em https://ads.google.com/aw/apicenter (3-7 dias de approval).',
      );
    }
    const res = await fetch(`${this.ADS_API_BASE}/customers:listAccessibleCustomers`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': devToken,
      },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Google listAccessibleCustomers ${res.status}: ${text.slice(0, 300)}`);
    }
    const json = (await res.json()) as { resourceNames?: string[] };
    // resourceNames vem como ["customers/1234567890", ...]
    return (json.resourceNames ?? []).map((rn) => rn.replace('customers/', ''));
  }

  private async fetchCustomerMeta(
    accessToken: string,
    customerId: string,
  ): Promise<{ name: string | null; currency: string | null }> {
    const devToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    if (!devToken) return { name: null, currency: null };

    const query = `SELECT customer.descriptive_name, customer.currency_code FROM customer LIMIT 1`;
    const res = await fetch(
      `${this.ADS_API_BASE}/customers/${customerId}/googleAds:search`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'developer-token': devToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
      },
    );
    if (!res.ok) return { name: null, currency: null };
    const json = (await res.json()) as {
      results?: Array<{
        customer?: { descriptiveName?: string; currencyCode?: string };
      }>;
    };
    const c = json.results?.[0]?.customer;
    return {
      name: c?.descriptiveName ?? null,
      currency: c?.currencyCode ?? null,
    };
  }

  private getRedirectUri(): string {
    const apiBase = (
      process.env.API_BASE_URL ?? 'https://api.active.eclick.app.br'
    ).replace(/\/+$/, '');
    return (
      process.env.GOOGLE_OAUTH_REDIRECT_URI ??
      `${apiBase}/ad-integrations/google/callback`
    );
  }
}
